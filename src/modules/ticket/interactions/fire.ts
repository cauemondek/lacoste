import {
  InteractionHandler,
  InteractionHandlerTypes,
  Result,
} from "@sapphire/framework";
import { ApplyOptions } from "@sapphire/decorators";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from "discord.js";

import { EmbedColors } from "$lib/constants/discord";
import { ENVIRONMENT } from "$lib/env";
import { getJobSectorsById } from "$lib/constants/jobs";
import { PromotionInteractionHandler } from "../../work/interactions/promotion";

export type Action = "Request" | "Approve" | "Reject";

export const BASE_BUTTON_ID = "LCST::FireInteractionHandler";
export const BASE_BUTTON_ID_REGEX = new RegExp(`^${BASE_BUTTON_ID}/`);

/** @internal @see {@link decodeButtonId} */
export function encodeButtonId(action: Action) {
  return `${BASE_BUTTON_ID}/${action}`;
}

/** @internal @see {@link encodeButtonId} */
export function decodeButtonId(id: string): Action {
  return id.replace(`${BASE_BUTTON_ID}/`, "") as Action;
}

type ParsedData = { action: Action };

const MODAL_INPUTS_OBJ = {
  Target: new TextInputBuilder()
    .setLabel("Demitido")
    .setPlaceholder("Informe o Habbo (Nick).")
    .setStyle(TextInputStyle.Short)
    .setCustomId("Target")
    .setRequired(true),

  Reason: new TextInputBuilder()
    .setStyle(TextInputStyle.Paragraph)
    .setLabel("Motivo da demissão")
    .setPlaceholder("Ex.: Inatividade")
    .setCustomId("Reason")
    .setRequired(false),
} satisfies Record<string, TextInputBuilder | "GENERATED">;

const MODAL_INPUTS = Object.values(MODAL_INPUTS_OBJ);
type ModalInput = keyof typeof MODAL_INPUTS_OBJ;

let interactionId: string;
let interactionDisplayAvatar: any;
let interactionTag: any;

let habboTargetStorage: string | undefined;
let habboInteractionName: string | undefined = undefined;
let habboInteractionAcceptName: string | undefined = undefined;

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.Button,
})
export class FireInteractionHandler extends InteractionHandler {
  private promotionHandler: PromotionInteractionHandler;
  constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options
  ) {
    super(context, options);
    this.promotionHandler = new PromotionInteractionHandler(context, options);
  }

  async #isAuthorized(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) {
      this.container.logger.warn(
        `[FireInteractionHandler#isAuthorized] ${interaction.user.tag} tried to perform an action in a DM.`
      );

      return false;
    }

    const { roles } =
      interaction.member ??
      (await interaction.guild.members.fetch(interaction.user.id));

    switch (decodeButtonId(interaction.customId)) {
      case "Request":
        return this.container.utilities.discord.hasPermissionByRole({
          checkFor: "INICIAL",
          category: "SECTOR",
          roles,
        });

      case "Reject":
      case "Approve":
        return this.container.utilities.discord.hasPermissionByRole({
          checkFor: "PRESIDÊNCIA",
          category: "SECTOR",
          roles,
        });

      default:
        throw new Error("Invalid Action");
    }
  }

  public override async parse(interaction: ButtonInteraction) {
    if (!interaction.customId.match(BASE_BUTTON_ID_REGEX)) return this.none();
    if (!(await this.#isAuthorized(interaction))) return this.none();

    return this.some({ action: decodeButtonId(interaction.customId) });
  }

  #APPROVAL_ROW = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeButtonId("Approve"))
      .setStyle(ButtonStyle.Success)
      .setLabel("Aprovar"),

    new ButtonBuilder()
      .setCustomId(encodeButtonId("Reject"))
      .setStyle(ButtonStyle.Danger)
      .setLabel("Reprovar")
  );

  public override async run(
    interaction: ButtonInteraction,
    { action }: ParsedData
  ) {
    if (!interaction.inGuild()) {
      this.container.logger.warn(
        `[FireInteractionHandler#run] ${interaction.user.tag} tried to perform an action in a DM.`
      );

      return;
    }

    const cachedGuild =
      interaction.guild ??
      (await this.container.client.guilds.fetch(interaction.guildId));

    if (action === "Request") {
      const { result, interaction: modalInteraction } =
        await this.container.utilities.inquirer.awaitModal<ModalInput>(
          interaction,
          {
            listenInteraction: true,
            inputs: MODAL_INPUTS,
            title: "Demissão",
          }
        );

      const onlyHabbo = (
        await this.container.utilities.habbo.getProfile(result.Target)
      ).unwrapOr(undefined);

      // if (!onlyHabbo?.name) {
      //   await modalInteraction.editReply({
      //     content:
      //       "Não consegui encontrar o perfil do usuário no Habbo, talvez sua conta esteja deletada ou renomeada? Veja se o perfil do usuário no jogo está como público.",
      //   });

      //   return;
      // }

      const rawName = result.Target.trim().replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const resultRaw: any = await this.container.prisma.$runCommandRaw({
        find: "User",
        filter: {
          habboName: {
            $regex: `^${rawName}$`,
            $options: "i",
          },
        },
        limit: 1,
      });

      const rawTargetDB = resultRaw.cursor.firstBatch[0];

      const targetDBOnlyHabbo = {
        ...rawTargetDB,
        _id: rawTargetDB._id?.$oid || rawTargetDB._id,
        id: rawTargetDB._id?.$oid || rawTargetDB._id,
        createdAt: rawTargetDB.createdAt?.$date
          ? new Date(rawTargetDB.createdAt.$date)
          : null,
        updatedAt: rawTargetDB.updatedAt?.$date
          ? new Date(rawTargetDB.updatedAt.$date)
          : null,
        latestPromotionDate: rawTargetDB.latestPromotionDate?.$date
          ? new Date(rawTargetDB.latestPromotionDate.$date)
          : null,
      };

      interactionDisplayAvatar = interaction.user.displayAvatarURL();
      interactionTag = interaction.user.tag;
      interactionId = interaction.user.id;

      // START USER WITHOUT DISCORD
      if (targetDBOnlyHabbo?.discordLink === false) {
        const guild =
          interaction.guild ??
          (await interaction.client.guilds.fetch(interaction.guildId));

        if (!targetDBOnlyHabbo.latestPromotionRoleId) {
          await modalInteraction.editReply({
            content:
              "Não consegui encontrar o setor do usuário, talvez sua conta esteja deletada ou renomeada?",
          });

          return;
        }

        const currentSectorEnvironment = Object.values(
          ENVIRONMENT.SECTORS_ROLES
        ).find((r) => r.id === targetDBOnlyHabbo.latestPromotionRoleId);

        if (!currentSectorEnvironment) {
          await modalInteraction.editReply({
            content:
              "Não consegui encontrar o setor do usuário, talvez sua conta esteja deletada ou renomeada?",
          });

          return;
        }

        const currentSector = await guild.roles.fetch(
          currentSectorEnvironment?.id
        );

        const currentJobEnvironment = Object.values(
          ENVIRONMENT.JOBS_ROLES
        ).find((r) => r.id === targetDBOnlyHabbo.latestPromotionJobId);

        if (!currentJobEnvironment) {
          await modalInteraction.editReply({
            content:
              "Não consegui encontrar o cargo do usuário, talvez sua conta esteja deletada ou renomeada?",
          });

          return;
        }

        const currentJob = await guild.roles.fetch(currentJobEnvironment?.id);

        if (!currentJob || !currentSector) {
          await modalInteraction.editReply({
            content: "||P94N|| Ocorreu um erro, contate o Desenvolvedor.",
          });

          return;
        }

        habboTargetStorage = targetDBOnlyHabbo.habboName;

        const authorResult = await Result.fromAsync(
          this.container.utilities.habbo.inferTargetGuildMember(
            `@${interaction.user.tag}`,
            true
          )
        );

        if (authorResult) {
          const { habbo: authorHabbo } = authorResult.unwrapOr({
            member: undefined,
            habbo: undefined,
          });

          habboInteractionName = authorHabbo?.name ?? "N/A";
        }

        const confirmationEmbed = new EmbedBuilder()
          .setThumbnail(
            onlyHabbo
              ? `https://www.habbo.com/habbo-imaging/avatarimage?figure=${onlyHabbo.figureString}&size=b`
              : null
          )
          .setFooter({
            text: `${targetDBOnlyHabbo.habboName ?? onlyHabbo?.name}`,
          })
          .setTitle("Você tem certeza que deseja demiti-lo(a)?");

        const { result: isConfirmed } =
          await this.container.utilities.inquirer.awaitButtons(
            modalInteraction,
            {
              question: {
                embeds: [confirmationEmbed],
              },
              choices: [
                {
                  id: "True" as const,
                  style: ButtonStyle.Success,
                  label: "Sim",
                },
                {
                  id: "False" as const,
                  style: ButtonStyle.Danger,
                  label: "Não",
                },
              ],
            }
          );

        if (isConfirmed === "False") {
          await modalInteraction.deleteReply();

          return;
        }

        const approvalChannel = await cachedGuild.channels.fetch(
          ENVIRONMENT.NOTIFICATION_CHANNELS.APPROVAL_REQUEST
        );

        if (!approvalChannel?.isTextBased()) {
          throw new Error("Can't send message to non-text channel.");
        }

        const authorDB = await this.container.prisma.user.findUnique({
          where: { discordId: interaction.user.id },
          select: { habboName: true },
        });

        const approvalEmbed = new EmbedBuilder()
          .setTitle(
            `Solicitação de Demissão de ${
              targetDBOnlyHabbo.habboName ?? onlyHabbo?.name
            }`
          )
          .setColor(EmbedColors.Default)
          .setAuthor({
            name: interaction.user.tag,
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setFooter({
            text: targetDBOnlyHabbo.id,
          })
          .addFields([
            {
              name: "👤 Demissor",
              value: `${
                authorDB.habboName ??
                habboInteractionName ??
                `@${interaction.user.tag}`
              }`,
            },
            {
              name: "📗 Cargo",
              value: `${currentJob}`,
            },
            {
              name: "🗒️ Motivo",
              value: result.Reason.length > 0 ? result.Reason : "N/D",
            },
          ])
          .setThumbnail(
            onlyHabbo
              ? `https://www.habbo.com/habbo-imaging/avatarimage?figure=${onlyHabbo.figureString}&size=b`
              : null
          );

        await approvalChannel.send({
          embeds: [approvalEmbed],
          components: [this.#APPROVAL_ROW],
          content: `<@&${ENVIRONMENT.SECTORS_ROLES.PRESIDÊNCIA.id}>`,
        });

        await modalInteraction.deleteReply();

        // END USER WITHOUT DISCORD
        return;
      }

      const { member: targetMemberPrivate, habbo: targetHabbo } =
        await this.container.utilities.habbo.inferTargetGuildMember(
          result.Target
        );

      const targetUserDb = await this.container.prisma.user.findUnique({
        where: {
          habboName: result.Target,
        },
        select: {
          id: true,
          discordId: true,
          latestPromotionDate: true,
          latestPromotionRoleId: true,
          habboName: true,
        },
      });

      if (!targetUserDb) {
        await modalInteraction.reply({
          content:
            "Não consegui encontrar o perfil do colaborador, tem certeza que ele está registrado no servidor?",
          ephemeral: true,
        });

        return;
      }

      const targetUser = await cachedGuild.members.fetch(
        targetUserDb.discordId
      );

      if (!targetUser) {
        await modalInteraction.reply({
          content:
            "Não consegui encontrar o perfil do colaborador, tem certeza que ele está registrado no servidor?",
          ephemeral: true,
        });
      }

      const currentJobRoleId =
        this.container.utilities.discord.inferHighestJobRole(
          targetUser.roles.cache.map((x) => x.id)
        );

      const currentJobRole =
        currentJobRoleId && (await cachedGuild.roles.fetch(currentJobRoleId));

      if (!currentJobRole) {
        await modalInteraction.reply({
          content:
            "Não consegui encontrar o cargo, tem certeza que ele está registrado no servidor?",
          ephemeral: true,
        });

        return;
      }

      habboTargetStorage = targetUserDb.habboName;

      const authorResult = await Result.fromAsync(
        this.container.utilities.habbo.inferTargetGuildMember(
          `@${interaction.user.tag}`,
          true
        )
      );

      if (authorResult) {
        const { habbo: authorHabbo } = authorResult.unwrapOr({
          member: undefined,
          habbo: undefined,
        });

        habboInteractionName = authorHabbo?.name ?? "N/A";
      }

      const confirmationEmbed = new EmbedBuilder()
        .setThumbnail(
          targetHabbo
            ? `https://www.habbo.com/habbo-imaging/avatarimage?figure=${targetHabbo?.figureString}`
            : null
        )
        .setFooter({
          text: `@${targetUser.user.tag ?? targetMemberPrivate?.user.tag} | ${
            targetUserDb.habboName ?? targetHabbo?.name
          }`,
          iconURL:
            targetUser.displayAvatarURL() ??
            targetMemberPrivate?.displayAvatarURL(),
        })
        .setTitle("Você tem certeza que deseja demiti-lo(a)?");

      const { result: isConfirmed } =
        await this.container.utilities.inquirer.awaitButtons(modalInteraction, {
          question: {
            embeds: [confirmationEmbed],
          },
          choices: [
            {
              id: "True" as const,
              style: ButtonStyle.Success,
              label: "Sim",
            },
            {
              id: "False" as const,
              style: ButtonStyle.Danger,
              label: "Não",
            },
          ],
        });

      if (isConfirmed === "False") {
        await modalInteraction.deleteReply();

        return;
      }

      const approvalChannel = await cachedGuild.channels.fetch(
        ENVIRONMENT.NOTIFICATION_CHANNELS.APPROVAL_REQUEST
      );

      if (!approvalChannel?.isTextBased()) {
        throw new Error("Can't send message to non-text channel.");
      }

      const authorDB = await this.container.prisma.user.findUnique({
        where: { discordId: interaction.user.id },
        select: { habboName: true },
      });

      const approvalEmbed = new EmbedBuilder()
        .setTitle(
          `Solicitação de Demissão de ${
            targetUserDb.habboName ?? targetHabbo?.name
          }`
        )
        .setColor(EmbedColors.Default)
        .setAuthor({
          name: interaction.user.tag,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setFooter({
          text: targetUserDb.id,
        })
        .addFields([
          {
            name: "👤 Demissor",
            value: `${
              authorDB.habboName ??
              habboInteractionName ??
              `@${interaction.user.tag}`
            }`,
          },
          {
            name: "📗 Cargo",
            value: `${currentJobRole}`,
          },
          {
            name: "🗒️ Motivo",
            value: result.Reason.length > 0 ? result.Reason : "N/D",
          },
        ])
        .setThumbnail(
          targetHabbo
            ? `https://www.habbo.com/habbo-imaging/avatarimage?figure=${targetHabbo?.figureString}`
            : null
        );

      await approvalChannel.send({
        embeds: [approvalEmbed],
        components: [this.#APPROVAL_ROW],
        content: `<@&${ENVIRONMENT.SECTORS_ROLES.PRESIDÊNCIA.id}>`,
      });

      await modalInteraction.deleteReply();

      return;
    }

    // ---------------------
    // -  Handle Approval  -
    // ---------------------

    const targetUserId = interaction.message.embeds[0].footer?.text;

    if (!targetUserId) {
      await interaction.reply({
        content: "||305|| Ocorreu um erro, contate o desenvolvedor.",
        ephemeral: true,
      });

      return;
    }

    if (action === "Reject") {
      await interaction.message.delete();

      return;
    }

    const targetDBamount = await this.container.prisma.transaction.findMany({
      where: {
        user: { id: targetUserId },
      },
    });

    const notificationChannel = await cachedGuild.channels.fetch(
      ENVIRONMENT.NOTIFICATION_CHANNELS.FORM_FIRE
    );

    const notificationCMBChannel = await cachedGuild.channels.fetch(
      ENVIRONMENT.NOTIFICATION_CHANNELS.CMB_LOGS
    );

    if (
      !notificationChannel?.isTextBased() ||
      !notificationCMBChannel?.isTextBased()
    ) {
      throw new Error("Can't send message to non-text channel.");
    }

    const targetUser = await this.container.prisma.user.findUnique({
      where: {
        id: targetUserId,
      },
    });

    if (!targetUser) {
      await interaction.reply({
        content: "||342|| Ocorreu um erro, contate o desenvolvedor.",
        ephemeral: true,
      });

      return;
    }

    const guild =
      interaction.guild ??
      (await interaction.client.guilds.fetch(interaction.guildId));

    if (targetUser.discordLink !== false) {
      const targetMember = await guild.members.fetch(targetUser.discordId);

      const currentJobRoleId =
        this.container.utilities.discord.inferHighestJobRole(
          targetMember.roles.cache.map((x) => x.id)
        );

      const currentJobRole =
        currentJobRoleId && (await guild.roles.fetch(currentJobRoleId));

      if (currentJobRoleId) {
        const sectorRoleKey = getJobSectorsById(currentJobRoleId);

        const sectorRole =
          sectorRoleKey &&
          (await guild.roles.fetch(
            ENVIRONMENT.SECTORS_ROLES[sectorRoleKey].id
          ));

        if (sectorRole)
          await guild.members.removeRole({
            user: targetUser.discordId,
            role: sectorRole,
          });
      }

      if (currentJobRole) {
        await guild.members.removeRole({
          user: targetUser.discordId,
          role: currentJobRole,
        });
      }
    }

    const authorResult = await Result.fromAsync(
      this.container.utilities.habbo.inferTargetGuildMember(
        `@${interaction.user.tag}`,
        true
      )
    );

    if (authorResult) {
      const { habbo: authorHabbo } = authorResult.unwrapOr({
        member: undefined,
        habbo: undefined,
      });

      habboInteractionAcceptName = authorHabbo?.name ?? "N/A";
    }

    await notificationChannel.send({
      embeds: [
        EmbedBuilder.from(interaction.message.embeds[0])
          .setTitle(`Demissão de ${habboTargetStorage}`)
          .addFields([
            {
              name: "🛡️ Autorizado Por",
              value: `${
                habboInteractionAcceptName ?? `@${interaction.user.tag}`
              }`,
            },
          ])
          .setColor(EmbedColors.LalaRed),
      ],
    });

    const {
      _sum: { amount },
    } = await this.container.prisma.transaction.aggregate({
      where: { user: { id: targetUserId } },
      _sum: { amount: true },
    });

    const oldAmount = amount ?? 0;

    if (!habboTargetStorage) {
      await interaction.reply({
        content: "||343|| Ocorreu um erro, contate o desenvolvedor.",
        ephemeral: true,
      });

      return;
    }

    const onlyHabbo = (
      await this.container.utilities.habbo.getProfile(habboTargetStorage)
    ).unwrapOr(undefined);

    const MONETARY_INTL = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "CAM",
      minimumFractionDigits: 0,
    });

    const authorDB = await this.container.prisma.user.findUnique({
      where: { discordId: interactionId },
      select: { habboName: true },
    });

    await notificationCMBChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Alteração de Saldo de ${habboTargetStorage}`)
          .setAuthor({
            name: interactionTag,
            iconURL: interactionDisplayAvatar,
          })
          .setDescription(
            `Seu saldo foi zerado pelo motivo que o Colaborador foi demitido por ${
              authorDB.habboName ?? habboInteractionName
            }`
          )
          .setColor(EmbedColors.LalaRed)
          .addFields([
            {
              name: "Saldo Anterior",
              value: `${
                targetDBamount
                  ? MONETARY_INTL.format(oldAmount ?? 0)
                  : "O usuário não possuia CAM acumulados"
              }`,
            },
            {
              name: "Saldo Atual",
              value: MONETARY_INTL.format(0),
            },
          ])
          .setThumbnail(
            onlyHabbo
              ? `https://www.habbo.com/habbo-imaging/avatarimage?figure=${onlyHabbo?.figureString}`
              : null
          ),
      ],
    });

    const medals = await this.container.prisma.medals.findMany({
      where: {
        users: {
          has: targetUser.discordId,
        },
      },
    });

    if (medals.length > 0) {
      for await (const medal of medals) {
        await guild.members
          .removeRole({
            user: targetUser.discordId,
            role: medal.discordId,
          })
          .catch(() =>
            this.container.logger.error(
              "[FireInteractionHandler#run] Error to remove Medal"
            )
          );

        await this.container.prisma.medals.update({
          where: {
            id: medal.id,
          },
          data: {
            users: {
              set: medal.users.filter((id) => id !== targetUser.discordId),
            },
          },
        });
      }
    }

    if (targetDBamount) {
      await this.container.prisma.transaction.deleteMany({
        where: {
          user: { id: targetUserId },
        },
      });
    } else {
      this.container.logger.error(`Member don't have any amount in database`);
    }

    if (targetUser.latestPromotionJobId && targetUser.latestPromotionRoleId)
      await this.promotionHandler.updateDiscordLogRole("FIRE", targetUser, [
        targetUser.latestPromotionJobId,
        targetUser.latestPromotionRoleId,
      ]);

    await this.container.prisma.user.delete({
      where: {
        id: targetUserId,
      },
    });

    await interaction.message.delete();

    return;
  }
}

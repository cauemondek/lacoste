import { ApplyOptions } from "@sapphire/decorators";
import {
  InteractionHandler,
  InteractionHandlerTypes,
  // Result,
} from "@sapphire/framework";

import {
  EmbedBuilder,
  GuildMember,
  Role,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  TextChannel,
} from "discord.js";

import { schedule } from "node-cron";
import { isTruthy, merge } from "remeda";

import { EmbedColors } from "$lib/constants/discord";
import { FormIds } from "$lib/constants/forms";
import { ENVIRONMENT } from "$lib/env";

enum OrganizationalFormInputIds {
  Time = "Time",
  Hall1 = "Hall1",
  Hall2 = "Hall2",
  Hall3 = "Hall3",
  Stage = "Stage",
  Total = "Total",
  Ombudsman = "Ombudsman",
  TopPosition = "TopPosition",
  GeneralCommand = "GeneralCommand",
  CommandAssistance = "CommandAssistance",
  Promotional = "Promotional",
  Training = "Training",
}

type OrganizationalFormInput = keyof typeof OrganizationalFormInputIds;

const MARKDOWN_CHARS_RE =
  /((`){1,3}|(\*){1,3}|(~){2}|(\|){2}|^(>){1,3}|(_){1,2})+/gm;

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.Button,
})
export class OrganizationalFormInteractionHandler extends InteractionHandler {
  public override async parse(interaction: ButtonInteraction) {
    if (!interaction.inGuild()) {
      throw new Error("Cannot check permissions outside of a guild.");
    }

    const guild = await this.container.utilities.discord.getGuild();

    const member = !(interaction.member instanceof GuildMember)
      ? await guild.members.fetch(interaction.member.user.id)
      : interaction.member;

    const isAuthorized = this.container.utilities.discord.hasPermissionByRole({
      category: "SECTOR",
      checkFor: "PROMOCIONAL",
      roles: member.roles,
    });

    if (!isAuthorized) {
      return this.none();
    }

    return interaction.customId === FormIds.Organizacional
      ? this.some()
      : this.none();
  }

  public override async run(interaction: ButtonInteraction) {
    const { result: resultPartial, interaction: interactionFromModal } =
      await this.container.utilities.inquirer.awaitModal<OrganizationalFormInput>(
        interaction,
        {
          inputs: [
            new TextInputBuilder()
              .setLabel("Horário")
              .setPlaceholder("Ex.: 20:00")
              .setCustomId(OrganizationalFormInputIds.Time)
              .setStyle(TextInputStyle.Short)
              .setRequired(true),

            new TextInputBuilder()
              .setLabel("Posição no TOP")
              .setPlaceholder("Ex.: 1º Lugar")
              .setCustomId(OrganizationalFormInputIds.TopPosition)
              .setStyle(TextInputStyle.Short)
              .setRequired(true),

            new TextInputBuilder()
              .setLabel("Quantidade")
              .setPlaceholder("Total de colaboradores presentes")
              .setCustomId(OrganizationalFormInputIds.Total)
              .setStyle(TextInputStyle.Short)
              .setRequired(true),

            new TextInputBuilder()
              .setLabel("Auxílio de Sede")
              .setPlaceholder("Auxílio de Sede")
              .setCustomId(OrganizationalFormInputIds.CommandAssistance)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),

            new TextInputBuilder()
              .setLabel("Comando Geral")
              .setPlaceholder("Comando Geral")
              .setCustomId(OrganizationalFormInputIds.GeneralCommand)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),
          ],
          listenInteraction: true,
          title: "Formulário Organizacional",
        }
      );

    const { result: resultPartial2, interaction: i } =
      await this.container.utilities.inquirer.awaitModal<OrganizationalFormInput>(
        interactionFromModal,
        {
          inputs: [
            new TextInputBuilder()
              .setLabel("Palco")
              .setPlaceholder("Palco")
              .setCustomId(OrganizationalFormInputIds.Stage)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),

            new TextInputBuilder()
              .setLabel("Ouvidoria")
              .setPlaceholder("Ouvidoria")
              .setCustomId(OrganizationalFormInputIds.Ombudsman)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),

            new TextInputBuilder()
              .setLabel("Hall 1")
              .setPlaceholder("Hall 1")
              .setCustomId(OrganizationalFormInputIds.Hall1)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),

            new TextInputBuilder()
              .setLabel("Hall 2")
              .setPlaceholder("Hall 2")
              .setCustomId(OrganizationalFormInputIds.Hall2)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),

            new TextInputBuilder()
              .setLabel("Hall 3")
              .setPlaceholder("Hall 3")
              .setCustomId(OrganizationalFormInputIds.Hall3)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),
          ],
          title: "Formulário Organizacional",
          startButtonLabel: "Continuar - 1",
        }
      );

    const { result: resultPartial3, interaction: interaction3 } =
      await this.container.utilities.inquirer.awaitModal<OrganizationalFormInput>(
        i,
        {
          inputs: [
            new TextInputBuilder()
              .setLabel("Sala Promocional")
              .setPlaceholder("Sala Promocional")
              .setCustomId(OrganizationalFormInputIds.Promotional)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),

            new TextInputBuilder()
              .setLabel("Sala de Treinamento")
              .setPlaceholder("Sala de Treinamento")
              .setCustomId(OrganizationalFormInputIds.Training)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),
          ],
          title: "Formulário Organizacional",
          startButtonLabel: "Continuar - 2",
        }
      );

    const resultFirst = merge(resultPartial, resultPartial2);
    const result = merge(resultFirst, resultPartial3);

    for (const [key, value] of Object.entries(result)) {
      if (isTruthy(value)) continue;
      result[key as OrganizationalFormInput] = "N/D";
    }

    const targets = {
      CommandAssistance: result.CommandAssistance,
      GeneralCommand: result.GeneralCommand,
      Ombudsman: result.Ombudsman,
      Stage: result.Stage,
      Hall1: result.Hall1,
      Hall2: result.Hall2,
      Hall3: result.Hall3,
      Promotional: result.Promotional,
      Training: result.Training,
    };

    type Targets = keyof typeof targets;

    this.container.logger.info(
      "[OrganizationalFormInteractionHandler#run] Report",
      { report: JSON.stringify(result, null, 2) }
    );

    const members: Record<Targets, (GuildMember | string)[]> = {
      CommandAssistance: [],
      GeneralCommand: [],
      Ombudsman: [],
      Hall1: [],
      Hall2: [],
      Hall3: [],
      Stage: [],
      Promotional: [],
      Training: [],
    };

    const unparsedTargets: [keyof typeof targets, string][] = [];

    for (const [key, value] of Object.entries(targets) as [Targets, string][]) {
      if (value === "N/D") continue;

      unparsedTargets.push(
        ...value
          .split(/[\s\n\r]+/gm)
          .filter((v) => v !== "")
          .map((v) => [key, v] as (typeof unparsedTargets)[number])
      );
    }

    const notFoundUsers: string[] = [];

    for (const [group, target] of unparsedTargets as [Targets, string][]) {
      // if (target === "N/D") continue;
      switch (target) {
        case "N/D":
          continue;

        case "n/D":
          continue;

        case "N/d":
          continue;

        case "n/d":
          continue;

        case "nd":
          continue;

        case "-":
          continue;

        case "-x-":
          continue;

        case "/":
          continue;

        case "//":
          continue;

        case ".":
          continue;

        case "x":
          continue;

        case "X":
          continue;

        case "|":
          continue;

        case "ninguem":
          continue;

        case "Ninguem":
          continue;

        case "Ninguém":
          continue;

        case "ninguém":
          continue;

        case "_":
          continue;

        case "0":
          continue;
      }

      try {
        // const onlyHabbo = (await this.container.utilities.habbo.getProfile(target)).unwrapOr(
        //   undefined,
        // );

        // if (!onlyHabbo?.name) {
        //   this.container.logger.warn(
        // 		`[OrganizationalFormInteractionHandler#run] Couldn't find target: ${target}.`,
        // 	);

        // 	members[group].push(target.replaceAll(MARKDOWN_CHARS_RE, "\\$&"));
        //   notFoundUsers.push(target);

        // 	continue;
        // }

        const rawName = target.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const resultRaw: any = await this.container.prisma.$runCommandRaw({
          find: "User",
          filter: {
            habboName: {
              $regex: `^${rawName}$`,
              $options: "i",
            },
          },
          limit: 2,
        });

        if (resultRaw.cursor?.firstBatch.length > 1) {
          await i
            .deleteReply()
            .catch(() =>
              this.container.logger.error("[Form] Couldn't delete reply i.")
            );

          await interactionFromModal
            .deleteReply()
            .catch(() =>
              this.container.logger.error(
                "[Form] Couldn't delete reply interactionFromModal."
              )
            );

          await interaction3.editReply({
            content: `Encontrei mais de um usuário que o nome contém: **${target}** \nEscreva o nick corretamente ou seja mais específico.`,
            embeds: [],
            components: [],
          });

          return;
        }

        // const inferredTarget = await Result.fromAsync(
        // 	this.container.utilities.habbo.inferTargetGuildMember(target),
        // );

        // const { habbo: targetHabbo, member: targetMember } =
        // 	inferredTarget.unwrapOr({ habbo: undefined, member: undefined });

        if (!resultRaw.cursor?.firstBatch.length) {
          this.container.logger.warn(
            `[OrganizationalFormInteractionHandler#run] Couldn't find target: ${target}.`
          );

          members[group].push(target.replaceAll(MARKDOWN_CHARS_RE, "\\$&"));
          notFoundUsers.push(target);

          continue;
        }

        for await (let user of resultRaw.cursor?.firstBatch) {
          if (user) {
            user = {
              ...user,
              _id: user._id?.$oid || user._id,
              id: user._id?.$oid || user._id,
              createdAt: user.createdAt?.$date
                ? new Date(user.createdAt.$date)
                : null,
              updatedAt: user.updatedAt?.$date
                ? new Date(user.updatedAt.$date)
                : null,
              latestPromotionDate: user.latestPromotionDate?.$date
                ? new Date(user.latestPromotionDate.$date)
                : null,
            };

            if (group === "GeneralCommand") {
              await this.container.prisma.user.update({
                where: { id: user.id },
                data: {
                  reportsHistory: { push: new Date() },
                  reportsHistoryCG: { push: new Date() },
                },
              });
            } else {
              await this.container.prisma.user.update({
                where: { id: user.id },
                data: { reportsHistory: { push: new Date() } },
              });
            }
          }

          members[group].push(
            user.habboName.replaceAll(MARKDOWN_CHARS_RE, "\\$&")
          );
        }
      } catch (error) {
        members[group].push(target.replaceAll(MARKDOWN_CHARS_RE, "\\$&"));
      }
    }

    this.container.logger.info(
      "[OrganizationalFormInteractionHandler#run] Members",
      { members: JSON.stringify(members, null, 2) }
    );

    const embed = new EmbedBuilder()
      .setTitle("Formulário Organizacional")
      .setFooter({
        text: interaction.user.tag,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .addFields(
        {
          name: "Horário",
          value: result[OrganizationalFormInputIds.Time],
        },
        {
          name: "Quantidade",
          value: result[OrganizationalFormInputIds.Total],
        },
        {
          name: "Posição no TOP",
          value: result[OrganizationalFormInputIds.TopPosition],
        },
        {
          name: "👥 Auxílio de Sede",
          value: this.#joinList(
            members.CommandAssistance.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "🏢 Comando Geral",
          value: this.#joinList(
            members.GeneralCommand.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "📣 Ouvidoria",
          value: this.#joinList(
            members.Ombudsman.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "🎤 Palco",
          value: this.#joinList(
            members.Stage.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "🏛️ Hall 1",
          value: this.#joinList(
            members.Hall1.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "🏛️ Hall 2",
          value: this.#joinList(
            members.Hall2.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "🏛️ Hall 3",
          value: this.#joinList(
            members.Hall3.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "💼 Sala Promocional",
          value: this.#joinList(
            members.Promotional.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        },
        {
          name: "🎯 Sala de Treinamento",
          value: this.#joinList(
            members.Training.map((x) =>
              typeof x === "string" ? x : x.user.toString()
            )
          ),
        }
      )
      .setColor(EmbedColors.Diary);

    const guild =
      interaction.guild ??
      (await interaction.client.guilds.fetch(ENVIRONMENT.GUILD_ID));

    const channel = await guild.channels.fetch(
      ENVIRONMENT.NOTIFICATION_CHANNELS.FORM_ORGANIZATIONAL
    );

    const notificationChannelNoIdentify =
      await this.container.client.channels.fetch(
        ENVIRONMENT.NOTIFICATION_CHANNELS.NOIDENTIFY_ORGANIZATIONAL
      );

    if (
      channel === null ||
      !channel.isTextBased() ||
      !notificationChannelNoIdentify?.isTextBased()
    ) {
      throw new Error("Forms channel not found or not a text channel.");
    }

    if (notFoundUsers.length > 0) {
      await (notificationChannelNoIdentify as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setDescription(
              `**<@&1009452772200030289> - Correção Identificada** \n
            ${notFoundUsers.join("\n")} \n`
            )
            .setFooter({
              text: "Usuários não vinculados/encontrados no nosso banco de dados.\nAcrescente a devida presença com o nick correto e vinculado.",
            }),
        ],
      });
    }

    await channel.send({
      embeds: [embed],
    });

    await i
      .deleteReply()
      .catch(() =>
        this.container.logger.error("[Form] Couldn't delete reply i.")
      );

    await interactionFromModal
      .deleteReply()
      .catch(() =>
        this.container.logger.error(
          "[Form] Couldn't delete reply interactionFromModal."
        )
      );

    await interaction3
      .deleteReply()
      .catch(() =>
        this.container.logger.error(
          "[Form] Couldn't delete reply interaction3."
        )
      );
  }

  public override onLoad() {
    schedule(
      "30 15 1,15 * *",
      // "*/1 * * * *",
      async () => {
        this.container.logger.info(
          "[OrganizacionalFormInteractionHandler#run] Auto/schedule: 'Relatório Organizacional', day 1 or 15 runned"
        );

        const users = await this.container.prisma.user.findMany({
          where: {
            AND: [
              {
                OR: [
                  { activeRenewal: null },
                  { activeRenewal: { isSet: false } },
                ],
              },
              { habboName: { not: "" }, discordLink: { not: false } },
              {
                latestPromotionJobId: {
                  notIn: [
                    ENVIRONMENT.JOBS_ROLES.ADMINISTRADOR.id,
                    ENVIRONMENT.JOBS_ROLES.ADMINISTRADOR_EM_OBS.id,
                  ],
                },
              },
            ],
            OR: [
              {
                latestPromotionRoleId:
                  ENVIRONMENT.SECTORS_ROLES.ADMINISTRATIVO.id,
              },
              { latestPromotionRoleId: ENVIRONMENT.SECTORS_ROLES.DIRETORIA.id },
              {
                latestPromotionRoleId: ENVIRONMENT.SECTORS_ROLES.PRESIDÊNCIA.id,
              },
              { latestPromotionRoleId: ENVIRONMENT.SECTORS_ROLES.FUNDAÇÃO.id },
            ],
          },
        });

        users.filter((user) => {
          this.container.logger.info(
            `[OrganizacionalFormInteractionHandler#run] userPrisma catch: ${user.habboName}`
          );
        });

        this.container.logger.info(
          `[OrganizacionalFormInteractionHandler#run] Fetched ${users.length} users`
        );

        const filteredUsers = users.filter((user) => {
          const reportsInLast15Days = user.reportsHistory.filter((report) => {
            const reportDate = new Date(report).getTime();
            const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;

            return reportDate >= fifteenDaysAgo;
          });

          return reportsInLast15Days.length < 5;
        });

        this.container.logger.info(
          `[OrganizacionalFormInteractionHandler#run] Filtered ${filteredUsers.length} users`
        );

        const cachedGuild = await this.container.client.guilds.fetch(
          ENVIRONMENT.GUILD_ID
        );

        const notificationChannel = await this.container.client.channels.fetch(
          ENVIRONMENT.NOTIFICATION_CHANNELS.FORM_ANALYTICS
        );

        if (notificationChannel?.isTextBased()) {
          try {
            await (notificationChannel as TextChannel).send({
              embeds: [
                new EmbedBuilder()
                  .setColor(EmbedColors.LalaRed)
                  .setTitle("Relatório Função Análise - Organizacional")
                  .setDescription(
                    `**${
                      filteredUsers.length
                    }** Colaboradores de cargos importantes que não compareceram com no mínimo 5 presenças nos relatórios presenciais durante 15 dias.\n\n${(
                      await Promise.all(
                        filteredUsers.map(async (user) => {
                          const member = await cachedGuild.members.fetch(
                            user.discordId
                          );

                          const currentJobId =
                            this.container.utilities.discord.inferHighestJobRole(
                              member.roles.cache.map((r) => r.id)
                            );

                          let job: Role | undefined | null;
                          if (currentJobId) {
                            job = currentJobId
                              ? await cachedGuild.roles.fetch(currentJobId)
                              : member.roles.highest;
                          }
                          return `- ${user.habboName} // ${job?.name ?? "N/A"}`;
                        })
                      )
                    ).join("\n")}`
                  )
                  .setFooter({
                    text: "📊 Este relatório é enviado de 15 em 15 dias, fazer as confirmações necessárias antes de tomar medidas. Membros em afastamento ativo foram descartados.",
                  }),
              ],
            });
          } catch (error) {
            this.container.logger.error(
              `[OrganizacionalFormInteractionHandler#run] Error to send embed: ${error} `
            );
          }
        }
      },
      { recoverMissedExecutions: false }
    );
    schedule(
      "11 0 * * *", // Executar às 00:10 todos os dias
      // "*/1 * * * *", // A cada minuto para testes
      async () => {
        this.container.logger.info(
          "[OrganizacionalFormInteractionHandler#run] Auto/schedule: 'Relatório Diário', daily runned"
        );

        const users = await this.container.prisma.user.findMany({
          where: {
            AND: [
              {
                OR: [
                  { activeRenewal: null },
                  { activeRenewal: { isSet: false } },
                ],
              },
              { habboName: { not: "" } },
            ],
          },
        });

        const today = new Date();
        const endOfDay = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
          0,
          10,
          0
        );
        const startOfDay = new Date(endOfDay.getTime() - 24 * 60 * 60 * 1000);

        const dailyUsers = users.filter((user) => {
          return user.reportsHistory.some((report) => {
            const reportDate = new Date(report);
            return reportDate >= startOfDay && reportDate < endOfDay;
          });
        });

        const dailyCGUsers = users.filter((user) => {
          return user.reportsHistoryCG.some((report) => {
            const reportDate = new Date(report);
            return reportDate >= startOfDay && reportDate < endOfDay;
          });
        });

        const dailyUsersWithCount = dailyUsers.map((user) => {
          const count = user.reportsHistory.filter((report) => {
            const reportDate = new Date(report);
            return reportDate >= startOfDay && reportDate < endOfDay;
          }).length;
          return { user, count };
        });

        const dailyCGUsersWithCount = dailyCGUsers.map((user) => {
          const count = user.reportsHistoryCG.filter((report) => {
            const reportDate = new Date(report);
            return reportDate >= startOfDay && reportDate < endOfDay;
          }).length;
          return { user, count };
        });

        dailyUsersWithCount.sort((a, b) => b.count - a.count);
        dailyCGUsersWithCount.sort((a, b) => b.count - a.count);

        const notificationChannel = await this.container.client.channels.fetch(
          ENVIRONMENT.NOTIFICATION_CHANNELS.DIARY_ORGANIZATIONAL
        );
        const notificationChannelNoIdentify =
          await this.container.client.channels.fetch(
            ENVIRONMENT.NOTIFICATION_CHANNELS.NOIDENTIFY_ORGANIZATIONAL
          );

        const channel = await this.container.client.channels.fetch(
          ENVIRONMENT.NOTIFICATION_CHANNELS.FORM_ORGANIZATIONAL
        );

        if (
          notificationChannel?.isTextBased() &&
          notificationChannelNoIdentify?.isTextBased() &&
          channel?.isTextBased()
        ) {
          try {
            await (notificationChannel as TextChannel).send({
              embeds: [
                new EmbedBuilder()
                  .setColor(EmbedColors.Default)
                  .setTitle(
                    `<:lacoste:984848944649625661> Controle Diário Organizacional [${startOfDay.toLocaleDateString(
                      "pt-BR"
                    )}]`
                  )
                  .setDescription(
                    `**📊 Total de presenças nos relatórios presenciais (incluindo presenças no Comando Geral) ${
                      dailyUsers.length
                    } usuários:** \n\n${dailyUsersWithCount
                      .map((user) => `${user.user.habboName} - ${user.count}`)
                      .join("\n")}`
                  ),
              ],
            });

            await (notificationChannel as TextChannel).send({
              embeds: [
                new EmbedBuilder().setColor(EmbedColors.Default).setDescription(
                  `**🏆 Destaque Diário (Todos):**\n
					🥇 ${dailyUsersWithCount[0].user.habboName} - ${dailyUsersWithCount[0].count}`
                ),
              ],
            });

            await (notificationChannel as TextChannel).send({
              embeds: [
                new EmbedBuilder()
                  .setColor(EmbedColors.Default)
                  .setDescription(
                    `**📊 Total de presenças no Comando Geral ${
                      dailyCGUsers.length
                    } usuários:** \n\n${dailyCGUsersWithCount
                      .map((user) => `${user.user.habboName} - ${user.count}`)
                      .join("\n")}`
                  ),
              ],
            });

            await (notificationChannel as TextChannel).send({
              embeds: [
                new EmbedBuilder().setColor(EmbedColors.Default).setDescription(
                  `**🏆 Destaque Diário (CG):**\n
					🥇 ${dailyCGUsersWithCount[0].user.habboName} - ${dailyCGUsersWithCount[0].count} \n\n
					*Atenciosamente, Sistema Lacoste.*`
                ),
              ],
            });

            await (notificationChannelNoIdentify as TextChannel).send({
              content: `**🕛 FIM DO DIA** [${startOfDay.toLocaleDateString(
                "pt-BR"
              )}]`,
            });

            await (channel as TextChannel).send({
              content: `**🕛 FIM DO DIA** [${startOfDay.toLocaleDateString(
                "pt-BR"
              )}]`,
            });
          } catch (error) {
            this.container.logger.error(
              `[OrganizacionalFormInteractionHandler#run] Error to send embed: ${error} `
            );
          }
        }
      },
      { recoverMissedExecutions: false }
    );
  }

  #joinList(list: string[]) {
    if (list.length === 0) {
      return "N/D";
    }

    return `${list.map((x) => x.split("\\n")).join("\n")}`;
  }
}

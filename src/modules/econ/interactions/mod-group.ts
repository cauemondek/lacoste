import {
	InteractionHandler,
	InteractionHandlerTypes,
} from "@sapphire/framework";

import { ApplyOptions } from "@sapphire/decorators";
import {
	ButtonStyle,
	EmbedBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";

import { ENVIRONMENT } from "$lib/env";

import type { ButtonInteraction, GuildMember } from "discord.js";
import { EmbedColors } from "$lib/constants/discord";

export type Action = "Add" | "Del";

export const BASE_BUTTON_ID = "LCST::ModGroupInteractionHandler";
export const BASE_BUTTON_ID_REGEX = new RegExp(`^${BASE_BUTTON_ID}/`);

const MONETARY_INTL = new Intl.NumberFormat("pt-BR", {
	style: "currency",
	currency: "CAM",
});

/** @internal @see {@link decodeButtonId} */
export function encodeButtonId(action: Action) {
	return `${BASE_BUTTON_ID}/${action}`;
}

/** @internal @see {@link encodeButtonId} */
export function decodeButtonId(id: string): Action {
	return id.replace(`${BASE_BUTTON_ID}/`, "") as Action;
}

type ParsedData = { action: Action };

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button,
})
export class ModGroupInteractionHandler extends InteractionHandler {
	async #isAuthorized(interaction: ButtonInteraction) {
		if (!interaction.inCachedGuild()) {
			this.container.logger.warn(
				`[HireInteractionHandler#isAuthorized] ${interaction.user.tag} tried to perform an action in a DM.`,
			);

			return false;
		}

		const { roles } =
			interaction.member ??
			(await interaction.guild.members.fetch(interaction.user.id));

		return this.container.utilities.discord.hasPermissionByRole({
			checkFor: "FUNDAÇÃO",
			category: "SECTOR",
			roles,
		});
	}

	public override async parse(interaction: ButtonInteraction) {
		if (!interaction.customId.match(BASE_BUTTON_ID_REGEX)) return this.none();
		if (!(await this.#isAuthorized(interaction))) return this.none();

		return this.some({ action: decodeButtonId(interaction.customId) });
	}

	public override async run(interaction: ButtonInteraction, data: ParsedData) {
		if (!interaction.inGuild()) {
			this.container.logger.warn(
				`[ModGroupInteractionHandler#run] ${interaction.user.tag} tried to perform an action in a DM.`,
			);

			return;
		}

		const { result, interaction: i } =
			await this.container.utilities.inquirer.awaitModal<"Targets" | "Amount">(
				interaction,
				{
					inputs: [
						new TextInputBuilder()
							.setLabel("Usuários")
							.setCustomId("Targets")
							.setPlaceholder("Ex. @Usuário (Discord) ou Usuário (Habbo)")
							.setStyle(TextInputStyle.Short)
							.setRequired(true),

						new TextInputBuilder()
							.setCustomId("Amount")
							.setLabel("Quantidade de Câmbios")
							.setPlaceholder("A quantia de câmbios a ser adicionada")
							.setStyle(TextInputStyle.Short)
							.setRequired(false),
					],
					title: "Adicionar Saldo Grupo",
					listenInteraction: true,
				},
			);

		const guild =
			interaction.guild ??
			(await interaction.client.guilds.fetch(interaction.guildId));

		const [targetRoleId] =
			await this.container.utilities.inquirer.awaitSelectMenu(i, {
				choices: await Promise.all(
					Object.values(ENVIRONMENT.JOBS_ROLES).map(async (x) => ({
						id: x.id,
						label:
							guild.roles.cache.get(x.id)?.name ??
							(await guild.roles.fetch(x.id))?.name ??
							"Unknown",
					})),
				),
				placeholder: "Selecionar",
				question: "Escolha o cargo no qual deseja.",
			});

		if (!targetRoleId) {
			this.container.logger.warn(
				`[HireInteractionHandler#run] ${interaction.user.tag} tried to perform an action in a DM.`,
			);

			await i.editReply({
				content: "Nenhum cargo selecionado.",
			});

			return;
		}

		const rawAmount = Number(result.Amount);

		const amount =
			rawAmount > 0
				? rawAmount
				: ENVIRONMENT.JOBS_PAYMENT[
						Object.keys(ENVIRONMENT.JOBS_PAYMENT).find(
							(key) =>
								ENVIRONMENT.JOBS_ROLES[
									key as keyof typeof ENVIRONMENT.JOBS_ROLES
								].id === targetRoleId,
						) as keyof typeof ENVIRONMENT.JOBS_PAYMENT
				  ];

		const targets = result.Targets.split(",")
			.filter((x) => x.length > 0)
			.map((x) => x.trim());

		if (targets.length < 1) {
			await i.editReply({
				content: "Nenhum usuário informado ou todos estão inválidos.",
			});

			return;
		}

		if (Number.isNaN(amount) || amount < 0) {
			this.container.logger.warn(
				`[HireInteractionHandler#run] ${interaction.user.tag} tried to perform an action in a DM.`,
			);

			await i.editReply({
				content: `O salário deste cargo (${amount}) é inválido, contate o desenvolvedor.`,
			});

			return;
		}

		const members: GuildMember[] = [];

		for await (const target of targets) {
			const { member: targetMember } =
				await this.container.utilities.habbo.inferTargetGuildMember(target);

			if (!targetMember) {
				await i.editReply({
					content: "Não foi possível encontrar o usuário informado.",
					components: [],
					embeds: [],
				});

				return;
			}

			const targetUser = await this.container.prisma.user.findUnique({
				where: {
					discordId: targetMember.user.id,
				},
				select: {
					id: true,
					latestPromotionDate: true,
					latestPromotionRoleId: true,
				},
			});

			if (!targetUser) {
				this.container.logger.warn(
					"[HireInteractionHandler#run] Author or target user was not found in database.",
				);

				return;
			}

			this.container.logger.info(
				`[ModGroupInteractionHandler#run] Adding ${amount} to ${target} in group.`,
			);

			members.push(targetMember);
		}

		const { result: isConfirmed } =
			await this.container.utilities.inquirer.awaitButtons(i, {
				question: {
					embeds: [
						new EmbedBuilder()
							.setTitle("Confirmação")
							.setDescription(
								`Tem certeza que deseja executar a ação de ${
									data.action
								} para ${targets.length} ${
									targets.length === 1 ? "usuário" : "usuários"
								}?`,
							)
							.setFields([
								{
									name: "Usuários",
									value: `- ${members
										.map((x) => x.user.toString())
										.join("\n- ")}`,
								},
							])
							.setFooter({
								text: MONETARY_INTL.format(amount),
							})
							.setColor(EmbedColors.Default),
					],
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

		if (!isConfirmed) {
			await i.editReply({
				content: "Operação cancelada pelo usuário.",
				components: [],
				embeds: [],
			});

			return;
		}

		for (const member of members)
			await this.container.prisma.user.update({
				where: {
					discordId: member.user.id,
				},
				data: {
					ReceivedTransactions: {
						create: {
							amount: data.action === "Add" ? amount : -Math.abs(amount),
							author: { connect: { discordId: interaction.user.id } },
							reason: "Adicionado em grupo",
						},
					},
				},
			});

		await i.editReply({
			content: `Operação concluída com sucesso, todos os ${targets.length} ${
				targets.length === 1 ? "usuário" : "usuários"
			} receberão o valor de ${amount}.`,
			components: [],
			embeds: [],
		});
	}
}

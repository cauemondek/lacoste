import { ApplyOptions } from "@sapphire/decorators";
import {
	InteractionHandler,
	InteractionHandlerTypes,
} from "@sapphire/framework";

import {
	type ButtonInteraction,
	GuildMember,
	EmbedBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";

import { EmbedColors } from "$lib/constants/discord";
import { FormIds } from "$lib/constants/forms";

import { ENVIRONMENT } from "$lib/env";

enum FeedbackInputIds {
	Target = "Target",
	Clarification = "Clarification",
	Functionality = "Functionality",
	Additional = "Additional",
	Feedback = "Feedback",
}

type FeedbackInput = keyof typeof FeedbackInputIds;

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button,
})
export class InterviewFormInteractionHandler extends InteractionHandler {
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
			checkFor: "AVALIATIVO",
			roles: member.roles,
		});

		if (!isAuthorized) {
			return this.none();
		}

		return interaction.customId === FormIds.Entrevista
			? this.some()
			: this.none();
	}

	public override async run(interaction: ButtonInteraction) {
		const { result, interaction: i } =
			await this.container.utilities.inquirer.awaitModal<FeedbackInput>(
				interaction,
				{
					inputs: [
						new TextInputBuilder()
							.setLabel("Identificador (Discord ou Habbo)")
							.setPlaceholder(
								"Informe seu ID no Discord (@Nick) ou no Habbo (Nick).",
							)
							.setCustomId(FeedbackInputIds.Target)
							.setStyle(TextInputStyle.Short)
							.setRequired(true),

						new TextInputBuilder()
							.setLabel("Suas novas funções estão claras?")
							.setCustomId(FeedbackInputIds.Clarification)
							.setStyle(TextInputStyle.Short)
							.setRequired(true),

						new TextInputBuilder()
							.setLabel("Gostava de sua função anterior?")
							.setCustomId(FeedbackInputIds.Functionality)
							.setStyle(TextInputStyle.Short)
							.setRequired(true),

						new TextInputBuilder()
							.setLabel("Elogio ou reclamação sobre a promoção")
							.setCustomId(FeedbackInputIds.Feedback)
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(false),

						new TextInputBuilder()
							.setLabel("Informações adicionais")
							.setCustomId(FeedbackInputIds.Additional)
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(false),
					],
					listenInteraction: true,
					title: "Entrevista",
				},
			);

		await i.deleteReply();

		const { member: targetMember, habbo: targetHabbo } =
			await this.container.utilities.habbo.inferTargetGuildMember(
				result.Target,
			);

		if (!targetMember) {
			await i.reply({
				ephemeral: true,
				content: "Não foi possível encontrar o usuário informado.",
			});

			return;
		}

		const embed = new EmbedBuilder()
			.setTitle("Avaliação")
			.setThumbnail(
				`https://www.habbo.com/habbo-imaging/avatarimage?figure=${targetHabbo?.user.figureString}&size=b`,
			)
			.addFields([
				{
					name: "Identificador",
					value: result.Target,
				},
				{
					name: "Suas novas funções estão claras?",
					value: result.Clarification,
				},
				{
					name: "Gostava de sua função anterior?",
					value: result.Functionality,
				},
				{
					name: "Elogio ou reclamação sobre a promoção",
					value: result.Feedback.length > 0 ? result.Feedback : "N/A",
				},
				{
					name: "Informações adicionais",
					value: result.Additional.length > 0 ? result.Additional : "N/A",
				},
			])
			.setAuthor({
				name: interaction.user.tag,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setColor(EmbedColors.Default);

		const guild =
			interaction.guild ??
			(await interaction.client.guilds.fetch(ENVIRONMENT.GUILD_ID));

		const channel = await guild.channels.fetch(
			ENVIRONMENT.NOTIFICATION_CHANNELS.FORM_INTERVIEW,
		);

		if (channel === null || !channel.isTextBased()) {
			throw new Error(
				"Form interview channel not found or not a text channel.",
			);
		}

		await channel.send({
			embeds: [embed],
		});
	}
}

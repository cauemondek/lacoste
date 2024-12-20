import { ApplyOptions } from "@sapphire/decorators";
import { Command, type Args } from "@sapphire/framework";

import { EmbedBuilder, type Message } from "discord.js";

export const MONETARY_INTL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "CAM",
  minimumFractionDigits: 0,
});

@ApplyOptions<Command.Options>({
  name: "saldo",
  aliases: ["balance", "saldos"],
})
export class BalanceCommand extends Command {
  public override async messageRun(message: Message, args: Args) {
    const authorDB = await this.container.prisma.user
      .findUniqueOrThrow({
        where: {
          discordId: message.author.id,
        },
        select: {
          id: true,
          discordId: true,
          habboName: true,
          habboId: true,
        },
      })
      .catch(async (error) => {
        this.container.logger.error(
          `[BalanceMessageHandler#run] Error to get database author: ${error}`
        );

        await message.reply({
          content:
            "❌🐛 Ocorreu um erro ao buscar o usuário autor no banco de dados.",
        });
      });

    if (!authorDB) return;

    const user = (await args.pickResult("string")).unwrapOr(authorDB.habboName);

    const onlyHabbo = (
      await this.container.utilities.habbo.getProfile(user)
    ).unwrapOr(undefined);

    const targetDB = await this.container.prisma.user.findFirst({
      where: {
        habboName: {
          contains: user,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        discordId: true,
        habboName: true,
        habboId: true,
      },
    });

    const {
      _sum: { amount },
    } = await this.container.prisma.transaction.aggregate({
      where: { user: { habboId: targetDB?.habboId ?? authorDB.habboId } },
      _sum: { amount: true },
    });

    await this.container.utilities.discord.sendEphemeralMessage(message, {
      method: "reply",
      embeds: [
        new EmbedBuilder()
          .setTitle("Verificação de Saldo")
          .setDescription(
            (targetDB?.discordId ?? authorDB.discordId) === message.author.id
              ? `Seu saldo é de **${MONETARY_INTL.format(amount ?? 0)}**`
              : `**${targetDB?.habboName}** tem **${MONETARY_INTL.format(
                  amount ?? 0
                )}**`
          )
          .setThumbnail(
            onlyHabbo
              ? `https://www.habbo.com/habbo-imaging/avatarimage?figure=${onlyHabbo.figureString}&size=b`
              : null
          ),
      ],
    });
  }
}

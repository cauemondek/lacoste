import { z } from "zod";
import { SnowflakeRegex } from "./regexes";

export const Json = z
	.string()
	.transform((value) => tryCatch(() => JSON.parse(value), z.NEVER));

export const Snowflake = z.string().regex(SnowflakeRegex);

// Enums

export const Sectors = z.enum([
	"SISTEMA",
	"EXCLUSIVOS",
	"FEDERAÇÃO",
	"FUNDO",
	"PRESIDÊNCIA",
	"DIRETORIA",
	"ADMINISTRATIVO",
	"PROMOCIONAL",
	"AVALIATIVO",
	"INICIAL",
]);

export type Sector = z.infer<typeof Sectors>;

export const Committees = z.enum([
	"LÍDER_PROMOCIONAL",
	"LÍDER_ORGANIZACIONAL",
	"LÍDER_AVALIATIVO",
	"AJUDANTE_PROMOCIONAL",
	"AJUDANTE_ORGANIZACIONAL",
	"AJUDANTE_AVALIATIVO",
]);

export type Committee = z.infer<typeof Committees>;

export const Systems = z.enum([
	"AFASTADO15",
	"AFASTADO30",
	"RENOVADO15",
	"RENOVADO30",
]);

export type System = z.infer<typeof Systems>;

export const NotificationChannels = z.enum([
	"HABBO_USERNAME_ADDED",
	"HABBO_USERNAME_CHANGED",
]);

export type NotificationChannel = z.infer<typeof NotificationChannels>;

// Utils

/** Tries to execute a function and executes a fallback if it throws. */
function tryCatch<T>(fn: () => T, cb: () => T): T {
	try {
		return fn();
	} catch {
		return cb();
	}
}

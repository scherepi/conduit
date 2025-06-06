import { Signale, type DefaultMethods } from "signale";

const signale = new Signale({
	scope: "conduit",
	config: {
		displayTimestamp: true,
	},
});

const logMethods: DefaultMethods[] = [
	"await",
	"complete",
	"error",
	"debug",
	"fatal",
	"fav",
	"info",
	"note",
	"pause",
	"pending",
	"star",
	"start",
	"success",
	"warn",
	"watch",
	"log",
];

type LoggerMethods = DefaultMethods | `${DefaultMethods}Verbose`;
type Logger = {
	[K in LoggerMethods]: (...args: any[]) => void;
} & { verbose: boolean };

const logger: Logger = { verbose: false } as Logger;

logMethods.forEach(method => {
	logger[method] = signale[method];
	logger[`${method}Verbose`] = (...args: any[]) => logger.verbose && signale[method](...args);
});

export default logger;

#!/usr/bin/env bun

import { Command } from "commander";
import { connectToConduit } from "./client";
import { startServer } from "./server";
import logger from "./logger";
import chalk from "chalk";
import wrapAnsi from "wrap-ansi";

function isValidPort(port: string) {
	const portNumber = parseInt(port);
	return !isNaN(portNumber) && portNumber >= 0 && portNumber <= 65535;
}

const program = new Command();

program
	.name("conduit")
	.description("A smart TCP tunnel to expose local ports behind a NAT or firewall.")
	.version("1.0.0", "-V, --version", "Output the version number and exit")
	.helpOption("-h, --help", "Display help for command");

program.showHelpAfterError();
program.showSuggestionAfterError();

// add colors to the help menu by building it ourselves
program.configureHelp({
	subcommandTerm: cmd => chalk.green(cmd.name() + (cmd.alias() ? `|${cmd.alias()}` : "")),
    formatHelp: (cmd, helper) => {
        let help = "";
		if (helper.commandDescription(cmd)) {
            help += helper.commandDescription(cmd) + "\n\n";
        }

		const coloredCommandUsage = helper.commandUsage(cmd)
			.split(" ")
			.map(part => {
				if (part.startsWith("<") || part.startsWith("[")) {
					return part;
				}
				return chalk.green(part);
			})
			.join(" ");
        help += chalk.bold.underline("Usage:") + " " + coloredCommandUsage + "\n\n";
        const commands = helper.visibleCommands(cmd);
        if (commands.length > 0) {
            help += chalk.bold.underline("Commands:") + "\n";
            const termWidth = Math.max(...commands.map(c => helper.subcommandTerm(c).length)) + 2;
            const descWidth = (process.stdout.columns || 80) - termWidth - 4;
            help +=
                commands
                    .map(c => {
                        const term = "  " + helper.subcommandTerm(c).padEnd(termWidth);
                        const desc = helper.commandDescription(c) || "";
                        const wrapped = wrapAnsi(desc, descWidth, { hard: true })
                            .split("\n")
                            .map((line, i) => (i === 0 ? "" : " ".repeat(term.length)) + line)
                            .join("\n");
                        return term + wrapped;
                    })
                    .join("\n") + "\n\n";
        }
        const options = helper.visibleOptions(cmd);
        if (options.length > 0) {
            help += chalk.bold.underline("Options:") + "\n";
            const termWidth = Math.max(...options.map(o => helper.optionTerm(o).length)) + 2;
            const descWidth = (process.stdout.columns || 80) - termWidth - 4;
            help +=
                options
                    .map(o => {
                        const term = "  " + helper.optionTerm(o).padEnd(termWidth)
                            .split(" ")
                            .map(part => {
                                if (part.endsWith(",")) {
                                    return chalk.green(part.slice(0, -1)) + ",";
                                } else if (part.startsWith("<") && part.endsWith(">")) {
                                    // return chalk.blackBright("<") + part.slice(1, -1) + chalk.blackBright(">");
                                    return part
                                } else {
                                    return chalk.green(part);
                                }
                            }).join(" ");
                        const desc = helper.optionDescription(o).replaceAll('"', "") || "";
                        const wrapped = wrapAnsi(desc, descWidth, { hard: true })
                            .split("\n")
                            .map((line, i) => (i === 0 ? "" : " ".repeat(term.length)) + line)
                            .join("\n");
                        return term + wrapped;
                    })
                    .join("\n") + "\n";
        }
        return help;
    },
});

program.addHelpText(
	"after",
	`
${chalk.bold.underline("Example Usage")}:
  ${chalk.blackBright("$")} conduit 8080`
);

program
	.command("client <PORT>", { isDefault: true })
	.description("Expose a local port through the conduit server")
	.option(
		"-t, --to <SERVER>",
		"The conduit server to expose the local port on (default: conduit.ws)"
	)
	.option(
		"-p, --remotePort <PORT>",
		"The remote port to request on the conduit server (default: 0)"
	)
	.option("-d, --subdomain <SUBDOMAIN>", "The subdomain to request from the server")
	.option("-k, --keepAlive", "Keeps this connection alive indefinitely", false)
	.option("-s, --secret <SECRET>", "Secret key for authentication (optional) (default: environment variable CONDUIT_SECRET)")
	.option("-v, --verbose", "Enable verbose output")
	.action((port, options) => {
		logger.verbose = options.verbose ? true : false;

		if (!isValidPort(port)) {
			logger.error("Invalid port number. Please provide a valid port between 0 and 65535.");
			process.exit(1);
		}
		if (options.remotePort && !isValidPort(options.remotePort)) {
			logger.error("Invalid port number. Please provide a valid port between 0 and 65535.");
			process.exit(1);
		}

		const server = options.to || "conduit.ws";

		let subdomain = options.subdomain;
		if (subdomain) {
			if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
				logger.error("Subdomain must be alphanumeric (letters, numbers, and hyphens only).");
				process.exit(1);
			}

			// foo.conduit.ws -> foo
			if (subdomain.endsWith(server)) {
				subdomain = subdomain.slice(0, -server.length - 1);
			}
		}

		const secret = options.secret || process.env.CONDUIT_SECRET; 

		connectToConduit(
			server,
			parseInt(port),
			options.keepAlive,
			parseInt(options.remotePort) || null,
			subdomain,
			secret
		);
	});

program
	.command("server")
	.description("Start a remote conduit server")
	.option("-d, --domain <DOMAIN>", "The domain to use for web traffic tunneling (required for HTTPS)")
	.option(
		"-b, --bind <BIND_ADDR>",
		"The address to bind the server to",
		"0.0.0.0"
	)
	.option(
		"-t, --tunnelBind <BIND_TUNNELS>",
		"The address to bind tunnels to",
		"0.0.0.0"
	)
	.option(
		"-m, --minPort <MIN_PORT>",
		"The minimum port of the port range on which you want to allow incoming conections",
		"1024"
	)
	.option(
		"-M, --maxPort <MAX_PORT>",
		"The maximum port of the port range on which you want to allow incoming connections",
		"65535"
	)
	.option("-s, --secret <SECRET>", "Secret key for authentication (optional) (default: environment variable CONDUIT_SECRET)")
	.action((options, _command) => {
		if (options.minPort && isNaN(parseInt(options.minPort))) {
			logger.error("Minimum port needs to be valid integer.");
		}
		if (options.maxPort && isNaN(parseInt(options.maxPort))) {
			logger.error("Maximum port needs to be valid integer.");
		}
		const secret = options.secret || process.env.CONDUIT_SECRET; 

		startServer(
			options.bind,
			options.tunnelBind,
			parseInt(options.minPort),
			parseInt(options.maxPort),
			options.domain,
			secret
		);
	});

if (process.argv.length <= 2) {
	program.help();
} else {
	program.parse();
}

// Main CLI logic, started by Joaquin 6/5/2025
import { Command } from "commander";
import { connectToConduit } from "./client";
import { startServer } from "./server";
import logger from "./logger";
const program = new Command();


program
	.name("conduit")
	.description("Conduit - a link between worlds.")
	.version("1.0.0", "-V, --version", "Output the version number and exit")
	.helpOption("-h, --help", "Display help for command");

program.showHelpAfterError();
program.showSuggestionAfterError();

program
	.command("client <PORT>", { isDefault: true })
	.description("Expose a local port through the conduit server")
	.requiredOption("-t, --to <HOST>", "The conduit server to expose the local port on", "conduit.ws")
	.option(
		"-p, --remotePort <PORT>",
		"The remote port to request on the conduit server (default: 0)",
	)
	.option(
		"-d, --subdomain <SUBDOMAIN>",
		"The subdomain to request from the server"
	)
	.option("-k, --keepAlive", 
		"Keeps this connection alive indefinitely", false)
	.option("-v, --verbose", "Enable verbose output")
	.action((port, options) => {
		logger.verbose = options.verbose ? true : false;;

		connectToConduit(options.to, parseInt(port), options.keepAlive, parseInt(options.remotePort) || null, options.subdomain);
	});

// conduit server <bindAddress> -t tunnelAddress -m minimumPort -M maximumPort
program
	.command("server")
	.option("-d, --domain <DOMAIN>", "the domain to use for the server")
	.option("-b, --bind <BIND_ADDR>", "the address to bind the server to (default: 0.0.0.0)", "0.0.0.0")
	.option("-t, --tunnelBind <BIND_TUNNELS>", "the address to bind tunnels to (default: 0.0.0.0)", "0.0.0.0")
	.option(
		"-m, --minPort <MIN_PORT>",
		"the minimum port of the port range on which you want to allow incoming conections (default: 1024)",
		"1024"
	)
	.option(
		"-M, --maxPort <MAX_PORT>",
		"the maximum port of the port range on which you want to allow incoming connections (default: 65535)",
		"65535"
	)
	.action((options, command) => {
		if (options.minPort && isNaN(parseInt(options.minPort))) {
			logger.error("Minimum port needs to be valid integer.");
		}
		if (options.maxPort && isNaN(parseInt(options.maxPort))) {
			logger.error("Maximum port needs to be valid integer.");
		}
		startServer(
			options.bind,
			options.tunnelBind,
			parseInt(options.minPort),
			parseInt(options.maxPort)
		);
	});

if (process.argv.length <= 2) {
	program.help();
} else {
	program.parse();
}

// Main CLI logic, started by Joaquin 6/5/2025
import { Command } from 'commander';
import { runClient } from './client';
const program = new Command();

program
	.name('conduit')
	.description('Conduit - a link between worlds.')
	.version('1.0.0');

program
	// conduit remotehost -l localPort -p remotePort -d subdomain -v verbosityLevel 
	.argument('<remotehost>', 'the remote host to try to tunnel to')
	.requiredOption('-l, --localPort <portNumber>', 'the local port to try to tunnel to the server', )
	.option('-p, --remotePort <portNumber>', 'the remote port to request from the server (optional)')
	.option('-d, --subdomain <subdomain>', 'the subdomain to request from the server. -p and -d are mutually exclusive.')
	.option('-v, --verbosity <level>', 'set verbosity level', '3')
	.action((remoteHost, options, command) => {
		if (options.remotePort && options.subdomain) {
			console.error("You can't pick both, doofus!");
			console.log("Rerun the command with EITHER the subdomain argument or the remote port.");
		}
		if (options.remotePort) {
			runClient(remoteHost, options.localPort, options.verbosity, options.remotePort);
		}
		if (options.subdomain) {
			runClient(remoteHost, options.localPort, options.verbosity, options.subdomain);
		}
	})

// conduit server <bindAddress> -t tunnelAddress -m minimumPort -M maximumPort 
program.command('server')
	.description('Base functionality.')
	.argument('<bindAddress>', 'the address to bind the server to', '0.0.0.0')
	.option('-t, --tunnelBind', 'the address to bind tunnels to.', '0.0.0.0')
	.option('-m, --minPort', 'the minimum port of the port range on which you want to allow incoming conections', '1024')
	.option('-M, --maxPort', 'the maximum port of the port range on which you want to allow incoming connections', '65535')
	.action((bindAddress, options, command) => {
		if (options.tunnelBind) {

		}
	})


program.parse();
var blessed = require('neo-blessed');

import { getActiveSubdomains } from './server.ts';

var screen = blessed.screen({
    smartCSR: true
});

screen.title = 'blessed + bun?'

const tabString = "\t{white-fg}{blue-bg}Status{/blue-bg}{/white-fg}\t\tConnections";

var contentBox = blessed.box({
    top: 'center',
    right: '0',
    width: '100%',
    height: '90%',
    content: 'Hello {bold}world{/bold}!',
    tags: true,
    border: {
        type: 'line'
    },
    style: {
        fg: 'white',
        bg: '#ff8c0d',
        border: {
            fg: '#f0f0f0'
        },
        hover: {
            bg: 'green'
        }
    },
    clickable: true
});

var tabBox = blessed.box({
    top: '0',
    width: '100%',
    height: '10%',
    content: tabString,
    tags: true,
    border: {
        type: 'line'
    },
    style: {
        fg: 'white',
        bg: 'black',
        border: {
            fg: '#f0f0f0'
        },
        hover: {
            bg: 'green'
        }
    },
    clickable: true
});

screen.append(tabBox);
screen.append(contentBox);

contentBox.on('click', function(data) {
    contentBox.setContent('{center}Some different {red-fg}content{/red-fg}.{/center}');
    screen.render();
})

contentBox.key('enter', function(ch, key) {
    contentBox.setContent('{right}test test {black-fg}test{/black-fg} {/right}\n');
    contentBox.setLine(1, 'bar')
    contentBox.insertLine(1, 'foo')
    screen.render();
})

const statusActive = "\t{white-fg}{blue-bg}Status{/blue-bg}{/white-fg}\t\tConnections"
// Status tab, displays server status, uptime, etc.
screen.key('s', function(ch, key) {
    tabBox.setContent(statusActive);
    contentBox.setContent('\n\n{center}{green-fg}Server Status{/green-fg}{/center}');
    screen.render();
});


// Connections tab, lets you see active connections and leased subdomains
const connectionsActive = "\tStatus\t\t{white-fg}{blue-bg}Connections{/white-fg}{/blue-bg}"
screen.key('c', function(ch, key) {
    tabBox.setContent(connectionsActive);
    contentBox.setContent('{center}Connections{/center}');
    contentBox.setLine(2, '{center}Subdomains{/center}');
    screen.render();
})

screen.key('d', function(ch, key) {
    contentBox.insertLine(3, '[secret, gus, test]');
    screen.render();
})



screen.key(['escape', 'q', 'C-c'], function (ch, key) {
    return process.exit(0);
})

tabBox.setLine(2, '{center}{blue-bg}Status{/blue-bg}{/center}');

contentBox.focus();

screen.render();
// I made this for misc functions that aren't integral to the service but are quality of life


import chalk from 'chalk';


function formatString(string: string) {

    return string.substring(0,1).toUpperCase() + string.substring(1).toLowerCase();



}



export function appropiateLogs(success: boolean, content: string) {
    console.log("");

    if (success) {
        console.log(chalk.green(`\u{2705} - ${chalk.bgGreen("  " + chalk.black(formatString(content))+ "  ")}`))
    } else {

        console.error(chalk.red(`\u{274C} - ${chalk.bgRed("  " + chalk.bold.white(formatString(content))+ "  ")}`))
    }
}

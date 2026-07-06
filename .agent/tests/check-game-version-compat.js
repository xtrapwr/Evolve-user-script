const fs = require('fs');
const path = require('path');

const gameDir = 'c:/Users/xtrap/source_code/Evolve';
const varsPath = path.join(gameDir, 'src/vars.js');
const resourcesPath = path.join(gameDir, 'src/resources.js');
const packagePath = path.join(gameDir, 'package.json');

console.log("Checking Evolve Game Version Compatibility...");

if (!fs.existsSync(packagePath)) {
    console.error("FAIL: package.json not found at " + packagePath);
    process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.version !== '1.4.10') {
    console.error(`FAIL: Expected game version 1.4.10, but found ${pkg.version}`);
    process.exit(1);
}
console.log(`PASS: Game version is ${pkg.version}`);

if (!fs.existsSync(varsPath)) {
    console.error("FAIL: src/vars.js not found at " + varsPath);
    process.exit(1);
}
const varsContent = fs.readFileSync(varsPath, 'utf8');
if (!varsContent.includes("global['version'] = '1.4.10';")) {
    console.error("FAIL: global['version'] assignment not found in src/vars.js");
    process.exit(1);
}
console.log("PASS: global['version'] in vars.js matches '1.4.10'");

if (!fs.existsSync(resourcesPath)) {
    console.error("FAIL: src/resources.js not found");
    process.exit(1);
}
const resourcesContent = fs.readFileSync(resourcesPath, 'utf8');
if (!resourcesContent.includes("export function craftCost(manual=false){") && !resourcesContent.includes("function craftCost(")) {
    console.error("FAIL: craftCost function not found in src/resources.js");
    process.exit(1);
}

const expectedRecipes = [
    "Plywood: [{ r: 'Lumber', a: 100 }]",
    "Wrought_Iron: [{ r: 'Iron', a: 80 }]",
    "Sheet_Metal: [{ r: 'Aluminium', a: 120 }]"
];

for (const recipe of expectedRecipes) {
    const strippedRecipe = recipe.replace(/\s+/g, '');
    const strippedFile = resourcesContent.replace(/\s+/g, '');
    if (!strippedFile.includes(strippedRecipe)) {
        console.error(`FAIL: Recipe definition not found for: ${recipe}`);
        process.exit(1);
    }
}
console.log("PASS: Recipes match expectations.");
console.log("Game compatibility check passed successfully!");

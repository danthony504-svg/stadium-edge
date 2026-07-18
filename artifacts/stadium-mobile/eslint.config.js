const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "node_modules/*", "scripts/*", "server/*", "lib/**/*.test.ts"],
  },
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
]);

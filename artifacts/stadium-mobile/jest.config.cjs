module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^node:test$": "<rootDir>/test/node-test-bridge.cjs",
    "^expo/fetch$": "<rootDir>/test/fakes/expo-fetch.ts",
  },
  setupFiles: ["<rootDir>/test/jest.setup.cjs"],
};

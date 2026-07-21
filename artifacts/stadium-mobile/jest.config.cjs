module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^node:test$": "<rootDir>/test/node-test-bridge.cjs",
  },
  setupFiles: ["<rootDir>/test/jest.setup.cjs"],
};

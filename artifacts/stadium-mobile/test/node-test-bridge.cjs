const test = (name, options, fn) => {
  if (typeof options === "function") return global.test(name, options);
  return global.test(name, fn, options?.timeout);
};

module.exports = test;
module.exports.test = test;

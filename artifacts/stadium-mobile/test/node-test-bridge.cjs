const test = (name, options, fn) => {
  if (typeof options === "function") fn = options;
  return global.test(name, fn);
};

module.exports = test;
module.exports.test = test;

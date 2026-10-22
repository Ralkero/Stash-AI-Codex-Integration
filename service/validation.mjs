export function check(ok, code = "INVALID_INPUT") {
  if (!ok) throw Error(code);
}
export function object(value, keys) {
  check(value && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).every((k) => keys.includes(k)));
  return value;
}
export function string(value, max = 1000) {
  check(typeof value === "string" && value.length <= max);
  return value;
}
export function id(value) {
  check(typeof value === "string" && /^[1-9]\d{0,11}$/.test(value));
  return value;
}
export function integer(value, min, max) {
  check(Number.isInteger(value) && value >= min && value <= max);
  return value;
}
export function ids(value, max = 20) {
  check(Array.isArray(value) && value.length > 0 && value.length <= max);
  return [...new Set(value.map(id))];
}
export function choice(value, choices) {
  check(choices.includes(value));
  return value;
}

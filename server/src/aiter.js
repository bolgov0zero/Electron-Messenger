'use strict';
// Массивные операции с асинхронным условием. Array.filter/some/every с async-колбэком
// не работают: колбэк возвращает промис, а он всегда «истина».
async function filterAsync(arr, fn) {
  const keep = await Promise.all(arr.map((x, i) => fn(x, i)));
  return arr.filter((_, i) => keep[i]);
}
async function someAsync(arr, fn) {
  for (let i = 0; i < arr.length; i++) if (await fn(arr[i], i)) return true;
  return false;
}
async function everyAsync(arr, fn) {
  for (let i = 0; i < arr.length; i++) if (!(await fn(arr[i], i))) return false;
  return true;
}
module.exports = { filterAsync, someAsync, everyAsync };

import { threeWayMerge } from '../server/merge.js';
import assert from 'assert';

console.log('=== Запуск тестов алгоритма Three-Way Merge (из папки scripts) ===');

// Тест 1: Бесконфликтное слияние (изменения в разных строках)
const base1 = `Строка 1
Строка 2
Строка 3`;

const ours1 = `Строка 1 (изменено нами)
Строка 2
Строка 3`;

const theirs1 = `Строка 1
Строка 2
Строка 3 (изменено ими)`;

const res1 = threeWayMerge(base1, ours1, theirs1);
assert.strictEqual(res1.hasConflict, false, 'Тест 1 должен быть без конфликтов');
assert.strictEqual(
  res1.mergedText,
  `Строка 1 (изменено нами)
Строка 2
Строка 3 (изменено ими)`,
  'Тест 1: Текст слияния некорректен'
);
console.log('✔ Тест 1 пройден: Бесконфликтное слияние работает!');

// Тест 2: Слияние с конфликтом (изменение одной и той же строки)
const base2 = `Строка 1
Строка 2
Строка 3`;

const ours2 = `Строка 1
Строка 2 (изменено нами)
Строка 3`;

const theirs2 = `Строка 1
Строка 2 (изменено ими)
Строка 3`;

const res2 = threeWayMerge(base2, ours2, theirs2);
assert.strictEqual(res2.hasConflict, true, 'Тест 2 должен содержать конфликт');
assert.ok(res2.mergedText.includes('<<<<<<< Текущая версия (на диске)'), 'Маркер conflict-start отсутствует');
assert.ok(res2.mergedText.includes('======='), 'Разделитель конфликта отсутствует');
assert.ok(res2.mergedText.includes('>>>>>>> Предложенная версия'), 'Маркер conflict-end отсутствует');
console.log('✔ Тест 2 пройден: Обнаружение конфликтов работает!');

// Тест 3: Чистые вставки без пересечений
const base3 = `Строка 1
Строка 3`;

const ours3 = `Строка 1
Строка 2 (вставили мы)
Строка 3`;

const theirs3 = `Строка 1
Строка 3
Строка 4 (вставили они)`;

const res3 = threeWayMerge(base3, ours3, theirs3);
assert.strictEqual(res3.hasConflict, false, 'Тест 3 должен быть без конфликтов');
assert.strictEqual(
  res3.mergedText,
  `Строка 1
Строка 2 (вставили мы)
Строка 3
... (используйте правильный перенос строки)`.replace('... (используйте правильный перенос строки)', 'Строка 4 (вставили они)'),
  'Тест 3: Текст слияния некорректен'
);
console.log('✔ Тест 3 пройден: Независимые вставки работают!');

console.log('=== Все тесты успешно пройдены! ===');

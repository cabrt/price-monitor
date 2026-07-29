const { test } = require('node:test')
const assert = require('node:assert')

const { findWatch } = require('../lib/store')

const fixture = [
  { id: 'a1b2c3d4', label: 'Acme — Widget Pro 2000', url: 'https://acme.example/products/widget-pro-2000' },
  { id: 'e5f6a7b8', label: 'Bolt Supply — Widget Pro', url: 'https://bolt.example/shop/widget-pro' },
  { id: '7e8f9a0b', label: 'Bolt Supply — Gasket Kit L', url: 'https://bolt.example/shop/gasket-kit-l' },
]

test('resolves by exact id', () => {
  assert.equal(findWatch('e5f6a7b8', fixture).label, 'Bolt Supply — Widget Pro')
})

test('resolves by exact label, case-insensitively', () => {
  assert.equal(findWatch('acme — widget pro 2000', fixture).id, 'a1b2c3d4')
})

test('resolves by a unique partial label', () => {
  assert.equal(findWatch('Gasket', fixture).id, '7e8f9a0b')
})

test('resolves by a unique url fragment', () => {
  assert.equal(findWatch('widget-pro-2000', fixture).id, 'a1b2c3d4')
})

test('exact label beats a partial match against another entry', () => {
  const overlapping = [
    { id: 'x1', label: 'Widget', url: 'https://a.example/1' },
    { id: 'x2', label: 'Widget Pro', url: 'https://a.example/2' },
  ]
  assert.equal(findWatch('Widget', overlapping).id, 'x1')
})

test('ambiguous partial lists the candidates instead of guessing', () => {
  assert.throws(() => findWatch('Bolt Supply', fixture), (err) => {
    assert.match(err.message, /matches 2 watches/)
    assert.match(err.message, /e5f6a7b8/)
    assert.match(err.message, /7e8f9a0b/)
    return true
  })
})

test('unknown query lists what is available', () => {
  assert.throws(() => findWatch('nothing-here', fixture), /No watch matching/)
})

test('empty watch list gives a distinct error', () => {
  assert.throws(() => findWatch('anything', []), /No watches configured/)
})

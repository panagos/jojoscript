import { maskNonCode } from './lexer.js'

const FUNCTION_HEAD = /^[ \t]*(?:export[ \t]+)?(?:(?:pure|effectful)[ \t]+)?(async[ \t]+)?(?:(?:pure|effectful)[ \t]+)?fn[ \t]+([A-Za-z_$][\w$]*)[ \t]*\(/gm
const CLAUSE = /^([ \t]*)(requires|ensures)[ \t]+(.+?)[ \t]*$/

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function matchingClose(code, openIndex, open, close) {
  let depth = 0
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === open) depth++
    else if (code[i] === close && --depth === 0) return i
  }
  return -1
}

function parameterNames(params) {
  return params.split(',')
    .map(param => param.trim().match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/)?.[1])
    .filter(Boolean)
}

/*
 * Contract clauses sit on their own lines between a block function's
 * parameter list and its opening `{`:
 *
 *   fn divide(a, b)
 *     requires b != 0
 *     ensures result * b == a
 *   {
 */
export function findContracts(source) {
  const code = maskNonCode(source)
  const regex = new RegExp(FUNCTION_HEAD.source, FUNCTION_HEAD.flags)
  const contracts = []
  let match

  while ((match = regex.exec(code))) {
    const paramsOpen = match.index + match[0].length - 1
    const paramsClose = matchingClose(code, paramsOpen, '(', ')')
    if (paramsClose === -1) continue

    const headEnd = code.indexOf('\n', paramsClose)
    if (headEnd === -1 || /[{=]/.test(code.slice(paramsClose + 1, headEnd))) continue

    const clauses = []
    let position = headEnd + 1
    let bodyOpen = -1

    while (position < code.length) {
      const lineEnd = code.indexOf('\n', position) === -1 ? code.length : code.indexOf('\n', position)
      const line = source.slice(position, lineEnd)
      const clause = code.slice(position, lineEnd).match(CLAUSE)

      if (clause) {
        clauses.push({
          kind: clause[2],
          condition: line.slice(clause[1].length + clause[2].length).trim(),
          line: lineAt(source, position),
          start: position,
          end: lineEnd
        })
      } else if (line.trim().startsWith('{')) {
        bodyOpen = position + line.indexOf('{')
        break
      } else {
        break
      }
      position = lineEnd + 1
    }

    if (!clauses.length || bodyOpen === -1) continue

    const toEntry = ({ condition, line }) => ({ condition, line })
    contracts.push({
      name: match[2],
      async: Boolean(match[1]),
      params: parameterNames(source.slice(paramsOpen + 1, paramsClose)),
      line: lineAt(source, match.index + match[0].search(/\S/)),
      requires: clauses.filter(clause => clause.kind === 'requires').map(toEntry),
      ensures: clauses.filter(clause => clause.kind === 'ensures').map(toEntry),
      clauses,
      bodyOpen,
      bodyClose: matchingClose(code, bodyOpen, '{', '}')
    })
  }

  return contracts
}

function check(contract, { kind, condition }) {
  const error = `new ContractError(${JSON.stringify(contract.name)}, "${kind}", ${JSON.stringify(condition)})`
  return `if (!(${condition})) throw ${error};`
}

/*
 * The body runs inside an arrow function so `ensures` can inspect `result`
 * while `this` and `arguments` still refer to the declared function.
 */
export function transformContracts(source) {
  let result = source

  for (const contract of findContracts(source).reverse()) {
    const requires = contract.clauses.filter(clause => clause.kind === 'requires').map(clause => check(contract, clause))
    const ensures = contract.clauses.filter(clause => clause.kind === 'ensures').map(clause => check(contract, clause))

    let open = `{ ${requires.join(' ')}`
    let close = '}'
    if (ensures.length) {
      open += contract.async ? ' const result = await (async () => {' : ' const result = (() => {'
      close = `})(); ${ensures.join(' ')} return result }`
    }

    result = result.slice(0, contract.bodyClose) + close + result.slice(contract.bodyClose + 1)
    result = result.slice(0, contract.bodyOpen) + open.trimEnd() + result.slice(contract.bodyOpen + 1)
    for (const clause of [...contract.clauses].reverse()) {
      result = result.slice(0, clause.start) + result.slice(clause.end)
    }
  }

  return result
}

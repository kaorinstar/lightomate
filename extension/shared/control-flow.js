// 条件分岐（if）と繰り返し（forEach）の手順を扱います（#6）。chrome.* は使いません。
//
// フロー定義では、if と forEach の内側の手順を入れ子の一覧として書きます。実行の前に、入れ子の手順を
// 「条件に応じて飛ぶ先」を持つ平らな命令の一覧（program）に変換します。実行は命令の番号（pc）を
// 1 つずつ進めるだけになり、これまでの手順の番号による実行の仕組みをほぼそのまま使えます。
// 繰り返しの何件目かは、命令の番号とは別に、繰り返しの段ごとの記録（LoopFrame）で持ちます。

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./flow.js').Target} Target */

/** 内側に手順を持つ手順の種類です。 */
export const CONTROL_STEP_TYPES = ['if', 'forEach'];

/** if と forEach を入れ子にできる段数の上限です。 */
export const MAX_NESTING = 3;

/** forEach の繰り返しの上限（max）の既定値です。 */
export const DEFAULT_FOREACH_MAX = 100;

/** forEach の繰り返しの上限（max）に書ける最大の値です。 */
export const FOREACH_MAX_LIMIT = 500;

/**
 * 実行する命令です。number は、サイドパネルと実行履歴に表示する手順の番号（0 から数えます）です。
 * 入れ子を展開した通し番号で、flattenSteps の number と同じです。jump と next は、対応する手順が
 * ないため number を持ちません。
 * @typedef {(
 *   { op: 'step', number: number, step: Step } |
 *   { op: 'if', number: number, step: import('./flow.js').IfStep, elsePc: number } |
 *   { op: 'jump', to: number } |
 *   { op: 'forEach', number: number, step: import('./flow.js').ForEachStep, endPc: number } |
 *   { op: 'next', startPc: number }
 * )} Instruction
 */

/**
 * 実行中の繰り返しの 1 段分の記録です。
 * @typedef {object} LoopFrame
 * @property {number} startPc forEach の命令の番号
 * @property {number} index 処理中の行の番号（0 から数えます）
 * @property {number} count 繰り返しを始めた時点の行数
 */

/**
 * 手順を、入れ子を展開した順（親の手順、then、else の順）に並べます。
 * number は通し番号（0 から数えます）で、画面に「手順 N」と表示する番号と、値を記録していない入力欄の
 * 値を受け渡す番号に使います。入れ子のないフローでは、number は steps の添字と同じです。
 * @param {Step[]} steps
 * @returns {{ step: Step, number: number, depth: number }[]}
 */
export function flattenSteps(steps) {
  /** @type {{ step: Step, number: number, depth: number }[]} */
  const list = [];
  /**
   * @param {Step[]} items
   * @param {number} depth
   */
  const visit = (items, depth) => {
    for (const step of items) {
      list.push({ step, number: list.length, depth });
      for (const children of childLists(step)) {
        visit(children, depth + 1);
      }
    }
  };
  visit(steps, 0);
  return list;
}

/**
 * 通し番号（flattenSteps の number）の手順を返します。ない場合は undefined です。
 * @param {Step[]} steps
 * @param {number} number
 * @returns {Step | undefined}
 */
export function stepAt(steps, number) {
  return flattenSteps(steps)[number]?.step;
}

/**
 * 手順の一覧を、画面に表示する行の一覧にします。if の else の手前には、区切りの行（else）を置きます。
 * @param {Step[]} steps
 * @returns {({ kind: 'step', step: Step, number: number, depth: number } | { kind: 'else', depth: number })[]}
 */
export function outlineSteps(steps) {
  /** @type {({ kind: 'step', step: Step, number: number, depth: number } | { kind: 'else', depth: number })[]} */
  const rows = [];
  let number = 0;
  /**
   * @param {Step[]} items
   * @param {number} depth
   */
  const visit = (items, depth) => {
    for (const step of items) {
      rows.push({ kind: 'step', step, number, depth });
      number += 1;
      if (step.type === 'if') {
        visit(step.then, depth + 1);
        if (step.else) {
          rows.push({ kind: 'else', depth });
          visit(step.else, depth + 1);
        }
      } else if (step.type === 'forEach') {
        visit(step.steps, depth + 1);
      }
    }
  };
  visit(steps, 0);
  return rows;
}

/**
 * 手順の内側の手順の一覧を、展開する順に返します。
 * @param {Step} step
 * @returns {Step[][]}
 */
function childLists(step) {
  switch (step.type) {
    case 'if':
      return step.else ? [step.then, step.else] : [step.then];
    case 'forEach':
      return [step.steps];
    default:
      return [];
  }
}

/**
 * 入れ子の手順を、平らな命令の一覧に変換します。
 *
 * - if：条件を満たさない場合は elsePc へ飛びます。then の最後には、else を飛び越える jump を置きます。
 * - forEach：行が 0 件の場合は endPc（繰り返しの後）へ飛びます。内側の手順の後には next を置き、
 *   次の行があれば forEach の直後へ戻ります。
 * @param {Step[]} steps
 * @returns {Instruction[]}
 */
export function compileSteps(steps) {
  /** @type {Instruction[]} */
  const program = [];
  let number = 0;
  /** @param {Step[]} items */
  const emit = (items) => {
    for (const step of items) {
      const own = number;
      number += 1;
      if (step.type === 'if') {
        const instruction = { op: /** @type {const} */ ('if'), number: own, step, elsePc: -1 };
        program.push(instruction);
        emit(step.then);
        if (step.else) {
          const jump = { op: /** @type {const} */ ('jump'), to: -1 };
          program.push(jump);
          instruction.elsePc = program.length;
          emit(step.else);
          jump.to = program.length;
        } else {
          instruction.elsePc = program.length;
        }
      } else if (step.type === 'forEach') {
        const startPc = program.length;
        const instruction = { op: /** @type {const} */ ('forEach'), number: own, step, endPc: -1 };
        program.push(instruction);
        emit(step.steps);
        program.push({ op: 'next', startPc });
        instruction.endPc = program.length;
      } else {
        program.push({ op: 'step', number: own, step });
      }
    }
  };
  emit(steps);
  return program;
}

/**
 * 命令を 1 つ終えた後に、次に実行する命令の番号と、繰り返しの記録を返します。元の frames は変更しません。
 * @param {Instruction[]} program
 * @param {number} pc 終えた命令の番号
 * @param {LoopFrame[]} frames 繰り返しの記録（外側の段から順）
 * @param {boolean | number} [result] if では条件を満たしたか、forEach では処理する行数
 * @returns {{ pc: number, frames: LoopFrame[] }}
 */
export function advance(program, pc, frames, result) {
  const instruction = program[pc];
  switch (instruction.op) {
    case 'if':
      return { pc: result === true ? pc + 1 : instruction.elsePc, frames };
    case 'jump':
      return { pc: instruction.to, frames };
    case 'forEach': {
      const count = typeof result === 'number' ? result : 0;
      if (count <= 0) {
        return { pc: instruction.endPc, frames };
      }
      return { pc: pc + 1, frames: [...frames, { startPc: pc, index: 0, count }] };
    }
    case 'next': {
      const frame = frames.at(-1);
      if (frame && frame.index + 1 < frame.count) {
        return {
          pc: instruction.startPc + 1,
          frames: [...frames.slice(0, -1), { ...frame, index: frame.index + 1 }],
        };
      }
      return { pc: pc + 1, frames: frames.slice(0, -1) };
    }
    default:
      return { pc: pc + 1, frames };
  }
}

/**
 * 命令の番号に対応する、画面に表示する手順の番号です。jump と next は、その先で次に実行する手順の
 * 番号を返します。命令の一覧の終わりでは、手順の総数を返します。
 * @param {Instruction[]} program
 * @param {number} pc
 * @param {LoopFrame[]} frames
 * @param {number} total 手順の総数（flattenSteps の件数）
 * @returns {number}
 */
export function displayNumber(program, pc, frames, total) {
  let position = { pc, frames };
  for (;;) {
    const instruction = program[position.pc];
    if (instruction === undefined) {
      return total;
    }
    if (instruction.op !== 'jump' && instruction.op !== 'next') {
      return instruction.number;
    }
    position = advance(program, position.pc, position.frames);
  }
}

/**
 * ページで要素を探す範囲です。繰り返しの段ごとに、行の指定（forEach の items）と処理中の行の番号を、
 * 外側の段から順に並べます。content script はこれをたどって、処理中の行を探します。
 * @param {Instruction[]} program
 * @param {LoopFrame[]} frames
 * @returns {{ items: Target, index: number }[]}
 */
export function itemScope(program, frames) {
  return frames.map((frame) => {
    const instruction = program[frame.startPc];
    if (instruction.op !== 'forEach') {
      throw new Error('繰り返しの記録が、forEach の命令を指していません。');
    }
    return { items: instruction.step.items, index: frame.index };
  });
}

/**
 * 繰り返しの何件目かの表示です（例：「3 件目」、入れ子の場合は「2 件目の 3 件目」）。
 * @param {number[] | undefined} items 繰り返しの段ごとの、処理中の行の番号（1 から数えます）
 * @returns {string}
 */
export function itemText(items) {
  return items && items.length > 0 ? items.map((item) => `${item} 件目`).join('の ') : '';
}

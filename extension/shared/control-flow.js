// 条件分岐（if）と繰り返し（forEach）の手順を扱います（#6）。chrome.* は使いません。
// 繰り返しの中でのページの移動と、ページ送り（forEach の nextPage）は #95 で加えました。
// 条件を満たす間の繰り返し（while）は #103 で加えました。
//
// フロー定義では、if、forEach、while の内側の手順を入れ子の一覧として書きます。実行の前に、入れ子の手順を
// 「条件に応じて飛ぶ先」を持つ平らな命令の一覧（program）に変換します。実行は命令の番号（pc）を
// 1 つずつ進めるだけになり、これまでの手順の番号による実行の仕組みをほぼそのまま使えます。
// 繰り返しの何件目かは、命令の番号とは別に、繰り返しの段ごとの記録（LoopFrame）で持ちます。

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./flow.js').Target} Target */

/** 内側に手順を持つ手順の種類です。 */
export const CONTROL_STEP_TYPES = ['if', 'forEach', 'while'];

/** if、forEach、while を入れ子にできる段数の上限です。 */
export const MAX_NESTING = 3;

/** forEach の繰り返しの上限（max）の既定値です。 */
export const DEFAULT_FOREACH_MAX = 100;

/** forEach の繰り返しの上限（max）に書ける最大の値です。 */
export const FOREACH_MAX_LIMIT = 500;

/** while の繰り返しの上限（max）の既定値です（#103）。 */
export const DEFAULT_WHILE_MAX = 100;

/** while の繰り返しの上限（max）に書ける最大の値です（#103）。 */
export const WHILE_MAX_LIMIT = 500;

/** ページ送りの上限（maxPages）の既定値です（#95）。 */
export const DEFAULT_MAX_PAGES = 10;

/** ページ送りの上限（maxPages）に書ける最大の値です（#95）。 */
export const MAX_PAGES_LIMIT = 50;

/**
 * 実行する命令です。number は、サイドパネルと実行履歴に表示する手順の番号（0 から数えます）です。
 * 入れ子を展開した通し番号で、flattenSteps の number と同じです。jump、next、loop は、対応する手順が
 * ないため number を持ちません。
 * @typedef {(
 *   { op: 'step', number: number, step: Step } |
 *   { op: 'if', number: number, step: import('./flow.js').IfStep, elsePc: number } |
 *   { op: 'jump', to: number } |
 *   { op: 'forEach', number: number, step: import('./flow.js').ForEachStep, endPc: number } |
 *   { op: 'next', startPc: number } |
 *   { op: 'while', number: number, step: import('./flow.js').WhileStep, endPc: number } |
 *   { op: 'loop', startPc: number }
 * )} Instruction
 */

/**
 * 実行中の繰り返しの 1 段分の記録です。forEach と while（#103）の両方で使います。
 * @typedef {object} LoopFrame
 * @property {number} startPc forEach か while の命令の番号
 * @property {number} index forEach では処理中の行の番号、while では処理中の回の番号（どちらも 0 から数えます）
 * @property {number} count forEach では、処理中のページで繰り返しを始めた時点の行数。while では使わず、0 です
 * @property {number} [page] 処理中のページの番号（0 から数えます）。ページ送り（#95）で増えます。
 *   省略した場合は 0 です
 * @property {number} [done] 前のページまでに処理した行の数（#95）。省略した場合は 0 です
 * @property {string} [firstKey] 行を数えたときの 1 行目の目印（リンク先か画像の src、#95）。一覧のページへ戻った後に、同じ一覧かを
 *   確かめるために使います
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
      } else if (step.type === 'forEach' || step.type === 'while') {
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
    case 'while':
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
 * - while：条件を満たさない場合は endPc（繰り返しの後）へ飛びます。内側の手順の後には loop を置き、
 *   while の命令へ戻って条件を判定し直します（#103）。
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
      } else if (step.type === 'while') {
        const startPc = program.length;
        const instruction = { op: /** @type {const} */ ('while'), number: own, step, endPc: -1 };
        program.push(instruction);
        emit(step.steps);
        program.push({ op: 'loop', startPc });
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
 * @param {boolean | number} [result] if と while では条件を満たしたか、forEach では処理する行数、next では
 *   次のページへ送った後の行数（ページを送らない場合は省略します、#95）
 * @returns {{ pc: number, frames: LoopFrame[] }}
 */
export function advance(program, pc, frames, result) {
  const instruction = program[pc];
  switch (instruction.op) {
    case 'if':
      return { pc: result === true ? pc + 1 : instruction.elsePc, frames };
    case 'jump':
      return { pc: instruction.to, frames };
    case 'while': {
      // 初めて判定する場合は、繰り返しの記録を加えます。loop から戻った場合は、記録がすでにあります。
      const top = frames.at(-1);
      const entered = top !== undefined && top.startPc === pc;
      const outer = entered ? frames.slice(0, -1) : frames;
      if (result !== true) {
        return { pc: instruction.endPc, frames: outer };
      }
      return {
        pc: pc + 1,
        frames: entered ? frames : [...frames, { startPc: pc, index: 0, count: 0 }],
      };
    }
    case 'loop': {
      const frame = frames.at(-1);
      return {
        pc: instruction.startPc,
        frames: frame ? [...frames.slice(0, -1), { ...frame, index: frame.index + 1 }] : frames,
      };
    }
    case 'forEach': {
      const count = typeof result === 'number' ? result : 0;
      if (count <= 0) {
        return { pc: instruction.endPc, frames };
      }
      return { pc: pc + 1, frames: [...frames, { startPc: pc, index: 0, count }] };
    }
    case 'next': {
      const frame = frames.at(-1);
      // result が数の場合は、次のページへ送った後の行数です（#95）。0 件の場合は繰り返しを終えます。
      if (frame && typeof result === 'number') {
        if (result <= 0) {
          return { pc: pc + 1, frames: frames.slice(0, -1) };
        }
        return {
          pc: instruction.startPc + 1,
          frames: [
            ...frames.slice(0, -1),
            {
              ...frame,
              index: 0,
              count: result,
              page: (frame.page ?? 0) + 1,
              done: (frame.done ?? 0) + frame.count,
            },
          ],
        };
      }
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
 * 命令の番号に対応する、画面に表示する手順の番号です。jump、next、loop は、その先で次に実行する手順の
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
    if (instruction.op !== 'jump' && instruction.op !== 'next' && instruction.op !== 'loop') {
      return instruction.number;
    }
    position = advance(program, position.pc, position.frames);
  }
}

/**
 * ページで要素を探す範囲です。繰り返しの段ごとに、行の指定（forEach の items）と処理中の行の番号を、
 * 外側の段から順に並べます。content script はこれをたどって、処理中の行を探します。
 * while の段（#103）は行を持たないため、含めません。
 * @param {Instruction[]} program
 * @param {LoopFrame[]} frames
 * @returns {{ items: Target, index: number }[]}
 */
export function itemScope(program, frames) {
  return frames.flatMap((frame) => {
    const instruction = program[frame.startPc];
    if (instruction.op === 'while') {
      return [];
    }
    if (instruction.op !== 'forEach') {
      throw new Error('繰り返しの記録が、forEach か while の命令を指していません。');
    }
    return [{ items: instruction.step.items, index: frame.index }];
  });
}

/**
 * 繰り返しの段ごとの種類です（#103）。forEach の段は item（何件目）、while の段は round（何回目）です。
 * @param {Instruction[]} program
 * @param {LoopFrame[]} frames
 * @returns {('item' | 'round')[]}
 */
export function loopKinds(program, frames) {
  return frames.map((frame) => (program[frame.startPc]?.op === 'while' ? 'round' : 'item'));
}

/**
 * while の条件を満たして次の回を始める前に、上限（max）に達していないかを確かめます（#103）。
 * 達している場合は、止める理由を返します。while は「条件がなくなるまで」の繰り返しのため、上限に
 * 達しても条件を満たしていることは想定外の状態だからです。
 * @param {import('./flow.js').WhileStep} step
 * @param {LoopFrame | undefined} frame この while の記録。初めて判定する場合は undefined です
 * @param {string} condition 条件の説明（condition.js の describeCondition）
 * @returns {string | undefined}
 */
export function whileLimitError(step, frame, condition) {
  const max = step.max ?? DEFAULT_WHILE_MAX;
  if ((frame?.index ?? 0) >= max) {
    return (
      `繰り返し（while）が上限（${max} 回）に達しましたが、条件（${condition}）をまだ満たしています。` +
      'フローの while の max を増やすか、条件を見直してください。'
    );
  }
  return undefined;
}

/**
 * 繰り返しの何件目かの表示です（例：「3 件目」、入れ子の場合は「2 件目の 3 件目」）。
 * ページ送り（#95）を使う繰り返しでは、何ページ目かを先頭に添えます（例：「2 ページ目の 3 件目」）。
 * while の段（#103）は、何回目かを表示します（例：「3 回目」）。
 * @param {number[] | undefined} items 繰り返しの段ごとの、処理中の行か回の番号（1 から数えます）
 * @param {number} [page] 処理中のページの番号（1 から数えます）。ページ送りを使わない場合は省略します
 * @param {('item' | 'round')[]} [kinds] 段ごとの種類（loopKinds）。省略した場合は、すべて item です
 * @returns {string}
 */
export function itemText(items, page, kinds) {
  if (!items || items.length === 0) {
    return '';
  }
  const rows = items
    .map((item, index) => `${item} ${kinds?.[index] === 'round' ? '回目' : '件目'}`)
    .join('の ');
  return page === undefined ? rows : `${page} ページ目の ${rows}`;
}

/**
 * 行の処理を終えた後に、次に行うことです（#95）。
 * - row：同じページの次の行へ進みます。
 * - page：ページの最後の行を終えたため、次のページへ送ります（nextPage がある場合）。
 * - end：繰り返しを終えます。
 * @param {import('./flow.js').ForEachStep} step
 * @param {LoopFrame} frame
 * @returns {'row' | 'page' | 'end'}
 */
export function afterRow(step, frame) {
  if (frame.index + 1 < frame.count) {
    return 'row';
  }
  return step.nextPage ? 'page' : 'end';
}

/**
 * 次のページへ送る前に、ページ送りの上限（maxPages）に達していないかを確かめます（#95）。
 * 達している場合は、止める理由を返します。上限で黙って終えると、処理していない行があることに
 * 気付けないためです。
 * @param {import('./flow.js').ForEachStep} step
 * @param {LoopFrame} frame
 * @returns {string | undefined}
 */
export function pageLimitError(step, frame) {
  const maxPages = step.maxPages ?? DEFAULT_MAX_PAGES;
  if ((frame.page ?? 0) + 1 >= maxPages) {
    return (
      `「${step.items.label}」のページ送りが上限（${maxPages} ページ）に達しましたが、次のページがあります。` +
      'フローの forEach の maxPages を増やしてください。'
    );
  }
  return undefined;
}

/**
 * 次のページの行を加えると、繰り返しの上限（max）を超えないかを確かめます（#95）。max は、ページ送りを
 * 含めた全ページの行の合計の上限です。超える場合は、止める理由を返します。
 * @param {import('./flow.js').ForEachStep} step
 * @param {LoopFrame} frame 送る前のページの記録
 * @param {number} count 次のページの行数
 * @returns {string | undefined}
 */
export function rowLimitError(step, frame, count) {
  const max = step.max ?? DEFAULT_FOREACH_MAX;
  const total = (frame.done ?? 0) + frame.count + count;
  if (total > max) {
    return (
      `「${step.items.label}」の行が、${(frame.page ?? 0) + 2} ページ目までで ${total} 件あり、` +
      `繰り返しの上限（${max} 件）を超えています。フローの forEach の max を増やしてください。`
    );
  }
  return undefined;
}

/**
 * 行の処理の後に、一覧のページへ戻る必要があるかを返します（#95）。行の処理の途中でページが移動した
 * 場合（表示中のページの識別子が、行を数えたときと異なる場合）に true です。識別子が分からない場合は、
 * 戻りません。
 * @param {string | undefined} listDocumentId 行を数えたときのページの識別子
 * @param {string | undefined} currentDocumentId 表示中のページの識別子
 * @returns {boolean}
 */
export function needsReturn(listDocumentId, currentDocumentId) {
  return (
    listDocumentId !== undefined &&
    currentDocumentId !== undefined &&
    listDocumentId !== currentDocumentId
  );
}

/**
 * 一覧のページへ戻った後の一覧が、最初に数えたときと同じかを確かめます（#95）。行数か 1 行目の目印が
 * 異なる場合は、止める理由を返します。前のページの行の番号で、別の行を操作しないためです。
 * 1 行目の目印（行の中のリンク先か画像の src）も比べるのは、ページを読み込まずに一覧だけを差し替えるページ送りでは、URL を開き直すと
 * 1 ページ目に戻り、行数だけでは違いが分からないためです。
 * @param {string} label 行の指定の説明（items.label）
 * @param {{ count: number, firstKey?: string }} expected 最初に数えた行数と 1 行目の目印
 * @param {{ count: number, firstKey?: string }} actual 戻った後の行数と 1 行目の目印
 * @returns {string | undefined}
 */
export function returnedListError(label, expected, actual) {
  if (expected.count !== actual.count) {
    return (
      `一覧のページに戻った後、「${label}」の行が ${actual.count} 件になり、最初に数えた ${expected.count} 件と異なるため、停止しました。` +
      '一覧の内容が変わったか、URL を開き直しても同じ一覧が表示されないページです。'
    );
  }
  if (
    expected.firstKey !== undefined &&
    actual.firstKey !== undefined &&
    expected.firstKey !== actual.firstKey
  ) {
    return (
      `一覧のページに戻った後、「${label}」の 1 行目が最初と異なるため、停止しました。` +
      '一覧の内容が変わったか、URL を開き直しても同じ一覧が表示されないページです。'
    );
  }
  return undefined;
}

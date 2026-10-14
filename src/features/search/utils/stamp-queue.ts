/** 渡した仕事を 1 本ずつ順に走らせる。失敗しても列は止めない。 */
export type StampQueue = (task: () => Promise<void>) => Promise<void>;

export function createStampQueue(): StampQueue {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const done = tail.then(task);
    // 失敗で列を止めない。1 本落ちても、次の操作は投げられる。
    tail = done.catch(() => {});
    return done;
  };
}

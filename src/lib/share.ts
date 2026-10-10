/**
 * SNS の投稿画面を開く URL（#46 と共有するシェアの仕組み）。API も審査も要らない。
 * 並べるときは X を左、Threads を右にする（X の方が利用者が多い。オーナー判断、#167）。
 */
export function shareLinks(text: string, url: string) {
  return {
    threads: `https://www.threads.net/intent/post?${new URLSearchParams({ text: `${text} ${url}` })}`,
    x: `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url })}`,
  };
}

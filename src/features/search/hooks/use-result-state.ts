import { useMemo } from "react";
import { buildHeading, formatCount, isPayloadReady } from "../utils/heading";
import { resultLook, skeletonShops } from "../../../utils/skeleton";
import type { AppPayload, SearchMode } from "../../../types";
import { useSlow } from "../../../hooks/use-slow";

/**
 * 結果の領域に何を出すか（#214）。結果・見出し・件数と、待つ間の見え方をまとめて決める。
 *
 * 待つ間も結果の場所を空けない。同じ探し方で取り直す間は前の結果を残し、違う探し方へ移る間は
 * その形の骨組みを出す。どちらも 300ms を過ぎるまでは見た目を変えない（resultLook）。
 */
export function useResultState({
  mode,
  payload,
  stale,
  busy,
  connecting,
  awaitingOrigin,
}: {
  mode: SearchMode;
  payload: AppPayload;
  /** 呼び直した後で、手元の結果が古い。 */
  stale: boolean;
  busy: boolean;
  /** つながって最初の結果がそろうまで（Web）。 */
  connecting: boolean;
  awaitingOrigin: boolean;
}) {
  // つながる間の空の結果は「0 件」ではない。まだそろっていないので、骨組みを出す（#214）。
  const payloadReady = !connecting && isPayloadReady(payload, mode, awaitingOrigin, stale);
  const showResults = payloadReady && !awaitingOrigin;
  const waiting = !payloadReady && (busy || connecting) && !awaitingOrigin;
  // 0 件の結果も残す（骨組みに替えると、また 0 件だったときに縮んで跳ねる。#214 のレビュー）。
  // つながる間の空の結果は、まだ何も出していないので残さない。
  const keep = waiting && !connecting && payload.mode === mode;
  const look = resultLook(waiting, keep, useSlow(waiting));
  // 前の結果を残す間は、見出しも前の結果のまま（変えると行数が変わって跳ねる）。
  const heading = useMemo(
    () => buildHeading(mode, payload, payloadReady || keep),
    [mode, payload, payloadReady, keep],
  );
  const shops =
    showResults || keep
      ? payload.shops
      : waiting
        ? skeletonShops(mode, mode === "visited" ? payload.visited?.length : undefined)
        : [];
  const count =
    showResults || keep ? formatCount(mode, payload.total, shops.length, payload.decide) : null;
  return { payloadReady, showResults, waiting, look, heading, shops, count };
}

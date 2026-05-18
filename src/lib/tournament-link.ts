// Computes the TanStack Router link target for a tournament card.
// The hub route ("/tournament/$id") is used unless the tournament is currently
// "open" AND the lock cutoff is still in the future, in which case we deep-link
// straight into the lineup picker.
export interface TournamentLinkInput {
  id: string;
  status: string;
  lock_at: string;
}

export interface TournamentLinkTarget {
  to: "/tournament/$id" | "/tournament/$id/lineup";
  params: { id: string };
}

export function tournamentCardLink(
  t: TournamentLinkInput,
  nowMs: number = Date.now(),
): TournamentLinkTarget {
  const lockExpired = new Date(t.lock_at).getTime() <= nowMs;
  const goToLineup = t.status === "open" && !lockExpired;
  return {
    to: goToLineup ? "/tournament/$id/lineup" : "/tournament/$id",
    params: { id: t.id },
  };
}

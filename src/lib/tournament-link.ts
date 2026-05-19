// Tournament card always links to the hub. The hub provides "Enter Lineup".
export interface TournamentLinkInput {
  id: string;
  status: string;
  submission_deadline: string;
}

export interface TournamentLinkTarget {
  to: "/tournament/$id";
  params: { id: string };
}

export function tournamentCardLink(
  t: TournamentLinkInput,
  _nowMs: number = Date.now(),
): TournamentLinkTarget {
  return { to: "/tournament/$id", params: { id: t.id } };
}

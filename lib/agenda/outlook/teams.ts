/**
 * Gerador de Reuniões Online no Microsoft Teams via Microsoft Graph
 */

export interface TeamsMeetingResult {
  joinWebUrl: string;
  meetingId: string;
  threadId?: string;
}

export async function criarReuniaoTeams(params: {
  accessToken: string;
  subject: string;
  startTimeIso: string;
  endTimeIso: string;
}): Promise<TeamsMeetingResult> {
  const url = "https://graph.microsoft.com/v1.0/me/onlineMeetings";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDateTime: params.startTimeIso,
      endDateTime: params.endTimeIso,
      subject: params.subject,
      lobbyBypassSettings: {
        scope: "everyone",
        isDialInBypassEnabled: true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao criar reunião no Teams: ${errText}`);
  }

  const json = (await res.json()) as {
    joinWebUrl: string;
    id: string;
    chatInfo?: { threadId?: string };
  };

  return {
    joinWebUrl: json.joinWebUrl,
    meetingId: json.id,
    threadId: json.chatInfo?.threadId,
  };
}

export function teamsVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("https://teams.microsoft.com/") || url.includes("teams.live.com");
}

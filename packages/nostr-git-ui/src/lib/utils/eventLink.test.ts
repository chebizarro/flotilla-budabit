import { describe, expect, it } from "vitest";
import { nip19, type NostrEvent } from "nostr-tools";
import {
  getEventRelayHints,
  getReferenceRelayHints,
  makeEventNevent,
  makeGitIssueHref,
  makeNaddrFromAddress,
} from "./eventLink";

const event: NostrEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  kind: 1623,
  created_at: 1,
  content: "",
  tags: [
    ["a", `30617:${"3".repeat(64)}:repo`, "wss://repo.example.com"],
    ["repo", "wss://github.com/example/repo.git"],
  ],
  sig: "4".repeat(128),
};

describe("event links", () => {
  it("prefers explicit relay hints", () => {
    expect(getEventRelayHints(event, ["wss://seen.example.com"])).toEqual([
      "wss://seen.example.com",
    ]);
  });

  it("does not mistake reference relays for event relays", () => {
    expect(getEventRelayHints(event)).toEqual([]);
  });

  it("extracts relay hints from a specific reference", () => {
    expect(getReferenceRelayHints(event, "a", event.tags[0][1])).toEqual([
      "wss://repo.example.com",
    ]);
  });

  it("encodes relay, author, and kind hints in nevent links", () => {
    const decoded = nip19.decode(makeEventNevent(event, ["wss://seen.example.com"]));

    expect(decoded.type).toBe("nevent");
    expect(decoded.data).toMatchObject({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
      relays: ["wss://seen.example.com"],
    });
  });

  it("encodes repository reference relays in naddr links", () => {
    const decoded = nip19.decode(
      makeNaddrFromAddress(event.tags[0][1], getReferenceRelayHints(event, "a"))
    );

    expect(decoded.type).toBe("naddr");
    expect(decoded.data).toMatchObject({
      kind: 30617,
      pubkey: "3".repeat(64),
      identifier: "repo",
      relays: ["wss://repo.example.com"],
    });
  });

  it("builds canonical root-relative issue links from repository metadata", () => {
    const href = makeGitIssueHref(
      event.tags[0][1],
      event.id,
      getReferenceRelayHints(event, "a", event.tags[0][1])
    );

    expect(href).toMatch(/^\/git\/naddr1/);
    expect(href).toMatch(new RegExp(`/issues/${event.id}$`));
    expect(new URL(href, "https://example.com/git/another-repo/issues/current").pathname).toBe(
      href
    );
  });

  it("omits issue links without valid repository metadata", () => {
    expect(makeGitIssueHref("", event.id)).toBe("");
    expect(makeGitIssueHref("not-an-address", event.id)).toBe("");
    expect(makeGitIssueHref(event.tags[0][1], "")).toBe("");
  });
});

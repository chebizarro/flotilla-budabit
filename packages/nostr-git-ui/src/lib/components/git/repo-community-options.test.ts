import {describe, expect, it} from "vitest";
import {
  findRepoCommunityOption,
  getRepoCommunityOptionBinding,
  getRepoCommunityOptionKey,
  getRepoCommunityOptionLabel,
} from "./repo-community-options.js";

describe("repository community options", () => {
  it("keeps sibling definitions by the same controller independently selectable", () => {
    const controller = "a".repeat(64);
    const first = {
      controllerPubkey: controller,
      address: `32222:${controller}:${"1".repeat(64)}`,
      communityId: "1".repeat(64),
      name: "First project",
      about: "First definition",
    };
    const second = {
      controllerPubkey: controller,
      address: `32222:${controller}:${"2".repeat(64)}`,
      communityId: "2".repeat(64),
      name: "Second project",
      about: "Second definition",
    };

    expect(getRepoCommunityOptionKey(first)).toBe(first.address);
    expect(getRepoCommunityOptionKey(second)).toBe(second.address);
    expect(findRepoCommunityOption([first, second], second.address)).toBe(second);
    expect(getRepoCommunityOptionLabel(first)).toBe("First project - First definition");
    expect(getRepoCommunityOptionBinding(first)).toEqual({
      address: first.address,
      communityId: first.communityId,
    });
  });
});

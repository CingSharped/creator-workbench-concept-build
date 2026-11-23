const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildCollaboratorLinksBlock,
  mergeProfileBlocksIntoDescription
} = require("../dist/shared/creatorProfileLinks.js");

const emptyLinks = {
  youtube: null,
  tiktok: null,
  twitch: null,
  kick: null,
  instagram: null,
  x: null,
  discord: null,
  website: null
};

test("formats collaborator links as one featuring heading followed by links", () => {
  assert.equal(
    buildCollaboratorLinksBlock([
      {
        id: "isimon-enigma",
        displayName: "ISimonEnigmaI",
        profileLinks: {
          ...emptyLinks,
          youtube: "https://www.youtube.com/@ISimonEnigmaI",
          tiktok: "https://www.tiktok.com/@isimonenigmai",
          twitch: "https://www.twitch.tv/ipsychoenigmai"
        },
        speakerColorHex: null,
        voiceSamples: []
      }
    ]),
    "Featuring ISimonEnigmaI:\n\nYouTube: https://www.youtube.com/@ISimonEnigmaI\nTikTok: https://www.tiktok.com/@isimonenigmai\nTwitch: https://www.twitch.tv/ipsychoenigmai"
  );
});

test("re-inserting collaborator links replaces the existing formatted block", () => {
  const collaborator = {
    id: "isimon-enigma",
    displayName: "ISimonEnigmaI",
    profileLinks: {
      ...emptyLinks,
      twitch: "https://www.twitch.tv/ipsychoenigmai"
    },
    speakerColorHex: null,
    voiceSamples: []
  };
  const first = mergeProfileBlocksIntoDescription("A clip description.", emptyLinks, [collaborator]);
  const second = mergeProfileBlocksIntoDescription(first, emptyLinks, [collaborator]);

  assert.equal(second, first);
});

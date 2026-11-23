const test = require("node:test");
const assert = require("node:assert/strict");

const {
  countClipProposalsByFilter,
  filterClipProposals,
  matchesClipProposalSearch
} = require("../dist/shared/clipProposalPresentation.js");

function proposal(id, status, hook, reason, rejectionReason = undefined) {
  return { id, status, hook, reason, rejectionReason };
}

const proposals = [
  proposal("one", "proposed", "The clutch escape", "A clear gameplay payoff"),
  proposal("two", "approved", "A huge reaction", "Strong reaction beat"),
  proposal("three", "rejected", "The quiet setup", "Good context but no payoff", "Too slow for a short")
];

test("clip proposal counts are source-specific and include all statuses", () => {
  assert.deepEqual(countClipProposalsByFilter(proposals), {
    all: 3,
    unreviewed: 1,
    approved: 1,
    rejected: 1
  });
});

test("clip proposal filters preserve proposal order", () => {
  assert.deepEqual(filterClipProposals(proposals, "unreviewed", "").map((item) => item.id), ["one"]);
  assert.deepEqual(filterClipProposals(proposals, "approved", "").map((item) => item.id), ["two"]);
  assert.deepEqual(filterClipProposals(proposals, "rejected", "").map((item) => item.id), ["three"]);
});

test("clip proposal search matches hook, reasoning, and rejection reason", () => {
  assert.equal(filterClipProposals(proposals, "all", "CLUTCH")[0].id, "one");
  assert.equal(filterClipProposals(proposals, "all", "reaction")[0].id, "two");
  assert.equal(filterClipProposals(proposals, "all", "too slow")[0].id, "three");
  assert.equal(matchesClipProposalSearch(proposals[0], "  "), true);
  assert.deepEqual(filterClipProposals(proposals, "unreviewed", "reaction"), []);
});

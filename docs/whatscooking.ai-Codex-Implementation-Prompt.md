# whatscooking.ai — GEMINI INTEGRATION & TRUSTWORTHY FOOD DATA FOUNDATION

You are my implementation partner for whatscooking.ai, our active
DubHacks 2026 project.

Repository:
https://github.com/saanvikrishan/Dubhacks-26

Application directory:
whatscooking.ai/

My GitHub development branch:
kevin/logic-data-hardening

Previous commit:
90419ed

IMPORTANT:
We are actively participating in a time-constrained hackathon.
Multiple teammates are developing different parts simultaneously.

We need practical, reliable, mergeable implementation—not
a large architectural rewrite.

Your responsibility is to implement my portion of the system
while protecting my teammates' work.


============================================================
1. PRODUCT VISION AND DEVELOPMENT STRATEGY
============================================================

whatscooking.ai is a personalized food decision assistant for
university students.

The primary problem is DECISION FATIGUE.

The product answers:

"What should I eat, should I cook or eat out, and when does
that meal fit my schedule?"

Recommendations should consider:

- User preferences
- Dietary restrictions and allergens
- Nutrition goals
- Available ingredients
- Cooking equipment
- Available time
- Schedule conflicts
- Budget
- Location
- Verified food information

The long-term vision includes adaptive personalization,
persistent preferences, feedback-driven improvements,
and intelligent replanning.

However, we must not attempt to implement the entire
long-term vision during this task.

Our immediate strategy is:

1. Establish a clean connection between Gemini and our
   deterministic recommendation engine.

2. Build a small but trustworthy food-data foundation
   using official sources.

3. Demonstrate that the decision engine can evaluate
   real, source-backed food records.

4. Leave clean interfaces for frontend integration and
   future improvements.

DO NOT build an entire new application.

DO NOT replace existing working architecture.

DO NOT introduce unnecessary frameworks, microservices,
or additional AI agents.


============================================================
2. TEAM RESPONSIBILITIES AND FILE OWNERSHIP
============================================================

Our team has agreed on the following responsibilities.

SAURAV:
- Gemini API integration
- Python backend
- Natural language interpretation
- Structured AI responses
- Backend API endpoints
- Optional AI memory integrations

KEVIN (MY RESPONSIBILITY):
- Food data structures
- Nutrition data
- Input validation
- Data normalization
- Feasibility constraints
- Decision engine
- Recommendation filtering
- Ranking logic
- Replanning logic
- Decision explanations

SAANVI / MAHIKA:
- Frontend
- UI/UX
- Meal cards
- Dashboard
- Chat interface integration
- Deployment and frontend experience

The central architecture decision is:

GEMINI INTERPRETS.
THE DECISION ENGINE VALIDATES AND DECIDES.
THE FRONTEND PRESENTS THE RESULT.

Gemini is NOT the source of truth for nutrition,
prices, allergens, ingredient quantities, or
restaurant availability.

Our deterministic decision engine remains responsible
for checking hard constraints.


============================================================
3. REPOSITORY SAFETY — NON-NEGOTIABLE
============================================================

Before modifying anything:

1. Inspect the actual latest main branch.
2. Inspect my existing development branch.
3. Inspect existing commits and unmerged changes.
4. Inspect current working tree and uncommitted files.
5. Identify file ownership and possible conflicts.

My previous commit 90419ed contains fixes involving:

- engine.js
- nutrition.js
- calendar.js
- tests/kevin-logic.test.js

Preserve these changes.

Do not assume that my previous branch is up to date.

Use a new dedicated feature branch based on the latest
main, or another safe Git strategy after inspecting
the repository.

Suggested branch:

kevin/gemini-food-data-integration

Do not overwrite teammates' work.

Do not modify these files without coordination:

- App.jsx
- state.js
- package.json
- Shared UI components
- Saurav's Python backend
- Shared configuration files

Prefer adding isolated modules and tests.

If a shared file needs modification:

1. Explain why.
2. Identify the exact proposed change.
3. Document the required integration.
4. Leave the actual change for its owner unless
   explicit authorization has been provided.

Never force-push.

Never reset or discard uncommitted changes.

Never merge automatically into main.

Do not commit credentials, secrets, or API keys.


============================================================
4. TARGET SYSTEM ARCHITECTURE
============================================================

The intended application flow is:

USER INPUT
    |
    v
GEMINI API
Natural language interpretation
    |
    v
STRUCTURED INTENT JSON
    |
    v
VALIDATION / NORMALIZATION LAYER
    |
    v
PREVIEW USER STATE
    |
    v
FOOD DATA ADAPTER
    |
    v
DECISION ENGINE
    |
    +-- Hard constraints
    +-- Nutrition calculations
    +-- Time feasibility
    +-- Budget feasibility
    +-- Ingredient availability
    +-- Location / venue requirements
    |
    v
VERIFIED RECOMMENDATIONS
    |
    v
FRONTEND CARDS / CHAT
    |
    v
USER CONFIRMATION

Important distinction:

A preview recommendation is not a saved action.

Do not automatically update persistent preferences,
calendar events, meal plans, pantry quantities,
or consumption logs.

Do not automatically order food.


============================================================
5. PHASE 1 — GEMINI TO DECISION ENGINE BRIDGE
============================================================

GOAL:

Build a clean, safe, independently testable bridge
between Gemini's structured intent and our existing
JavaScript recommendation engine.

The backend already contains Gemini-related work.

Inspect its current implementation first.

Do not duplicate Saurav's Gemini integration.

We have agreed that Gemini should interpret natural
language into structured requests.

Example user request:

"I have 30 minutes before class, my budget is $10,
and I want something high in protein.
Should I cook or eat out?"

Proposed response:

{
  "action": "recommend",
  "mode": "compare",
  "sort": "protein",
  "contextPatch": {
    "available": 30
  },
  "profilePatch": {
    "budget": 10
  }
}

This is a proposed API contract.

Coordinate around it, but do not silently change
Saurav's backend.

Suggested endpoint:

POST /interpret-food

If the endpoint does not yet exist, build and test
against deterministic mock responses.

Do not require live Gemini credentials to complete
this phase.

SUPPORTED INPUTS:

action:
- recommend

mode:
- cook
- eatOut
- compare

sort:
- catalog
- time
- cost
- protein

contextPatch:
- available

profilePatch:
- budget

Validate types, ranges, enum values, and object
structure strictly.

Reject:

- Unknown actions
- Unsupported fields
- Invalid numbers
- Malformed JSON
- Unexpected nested objects
- Attempts to modify allergens or restrictions
- Attempts to modify calendar events
- Attempts to log meals
- Attempts to execute external actions

Create a temporary preview state using the
validated changes.

Do not mutate the actual application state.

Then invoke the existing recommendation functions.

Reuse:

src/domain/engine.js
src/domain/nutrition.js
src/domain/config.js
src/domain/contracts.d.ts

Suggested new modules:

src/domain/intent.js
src/adapters/geminiIntent.js

You may choose better locations if they fit the
existing architecture.

Do not introduce new dependencies unless necessary.

The result should include:

- Validated intent
- Applied preview changes
- Recommended candidates
- Feasibility results
- Reasons for rejection
- Known assumptions
- Missing data
- Source limitations

Use the existing deterministic recommendation
strategy.

IMPORTANT:

The current configuration intentionally disables
weighted scoring.

Do not activate weighted ranking in this phase.

Do not modify existing scoring configuration.


============================================================
6. PHASE 2 — TRUSTWORTHY FOOD DATABASE
============================================================

GOAL:

Establish a small, realistic food-data foundation
that can eventually support both Cook and Eat Out
recommendations.

This is NOT a request to build a nationwide food
database.

For now, the geographic scope is:

University of Washington, Seattle.

FOOD MODES:

A. COOK AT HOME
B. EAT AT UW CAMPUS DINING LOCATIONS

OFF-CAMPUS RESTAURANTS ARE EXPLICITLY DEFERRED.

Do not integrate Yelp, DoorDash, Uber Eats,
Google Places restaurant discovery, or broad
restaurant scraping in this task.

We will decide how to support off-campus restaurants
in a separate development phase.


------------------------------------------------------------
6A. COOK MODE — USDA FOODDATA CENTRAL
------------------------------------------------------------

PRIMARY SOURCE:

https://fdc.nal.usda.gov/api-guide

Use USDA FoodData Central as the primary source
for ingredient-level nutritional information.

Study the official API documentation first.

Relevant capabilities include:

- Food search
- Food detail retrieval
- Nutrient information
- Food identifiers
- Nutrient units
- Food data types

Implement a small USDA data adapter or an
appropriate verified-data import workflow.

Priorities:

1. Search for an ingredient.
2. Identify an appropriate USDA food record.
3. Preserve its FDC ID.
4. Verify food form and preparation state.
5. Extract supported nutritional values.
6. Normalize units correctly.
7. Calculate nutrients based on ingredient quantity.
8. Aggregate ingredient nutrition for recipes.
9. Scale recipe totals into individual servings.
10. Preserve source and uncertainty information.

Do not automatically select an arbitrary first
search result.

For example:

"Rice" can mean:

- Dry rice
- Cooked rice
- White rice
- Brown rice
- Different branded products

These are not interchangeable.

Ingredient matching must be explicit.

Nutrition calculations must distinguish:

- Per 100 g
- Per serving
- Per recipe
- Recipe yield
- Cooked versus raw weight

The database should preserve:

- USDA FDC ID
- USDA food description
- Original food data type
- Nutrient values and units
- Ingredient quantity
- Source URL
- Retrieval/check date
- Preparation assumptions
- Missing fields

Unknown nutrient values must remain null.

Do not represent unknown values as zero.

API SECURITY:

Use environment variables for API credentials.

Never expose the API key in frontend code.

Never commit the key.

Avoid excessive API requests.

Use cached or curated records for the hackathon demo
where appropriate.

If API access is unavailable:

- Implement the adapter interface.
- Provide a documented setup path.
- Use clearly labeled local fixtures.
- Report the limitation.

Do not fabricate successful API responses.


------------------------------------------------------------
6B. EAT OUT MODE — UW HFS NUTRITION
------------------------------------------------------------

PRIMARY SOURCE:

https://hfs.washington.edu/nutrition/

Use this official UW Housing & Food Services
resource for on-campus dining nutrition.

This resource should take priority over generic
USDA estimates for a specific UW dining item.

Inspect the actual source structure.

Do not assume UW provides a stable public JSON API.

Use a bounded, maintainable source-backed import
or manually curated dataset if necessary.

Relevant UW locations include:

- Center Table
- Local Point
- Husky Den
- By George
- District Market

Additional on-campus locations may be included
if accurate information is available.

Reuse existing repository location data when valid.

For each actual UW menu item, attempt to preserve:

- Exact menu item name
- Dining location
- Specific station, if available
- Published serving size
- Published calories
- Published protein, when available
- Published carbohydrates, when available
- Published fat, when available
- Published sodium, when available
- Published allergens
- Vegetarian / vegan indicators
- Source URL
- Date checked
- Relevant menu date or validity period

Preserve only information actually provided
by the source.

If protein is unavailable, keep it null.

If price is unavailable, keep it null.

If exact portion information is unavailable,
do not invent a portion weight.

Do not use USDA nutrition for a vaguely similar
food to claim exact UW dish nutrition.

IMPORTANT:

UW HFS nutrition information is approximate.

Venue listings do not guarantee that a dish is
currently being served.

A published menu is not proof of real-time stock.

Separate:

- Nutrition information
- Menu listing
- Venue operating hours
- Actual dish availability
- Price

These facts may require different sources.

Do not label a dish as currently available
unless that claim is independently supported.

For strict allergy restrictions, unknown or
insufficient allergen information must never be
treated as verified safety.

Allergy indicators must be interpreted cautiously.
A blank field must not automatically be treated
as a universal cross-contact safety guarantee.


------------------------------------------------------------
6C. SHARED FOOD RECORD FORMAT
------------------------------------------------------------

Both food modes should eventually use compatible
records that the decision engine can evaluate.

Inspect the current FoodRecord contract first.

Preserve compatibility where practical.

Do not rewrite the contract without reason.

A record should distinguish:

IDENTITY:
- Stable ID
- Name
- Cook / Eat out
- Description

FEASIBILITY:
- Cost
- Time components
- Required ingredients
- Equipment
- Location
- Venue hours

NUTRITION:
- Nutrients
- Serving basis
- Portion
- Units
- Data quality

DIETARY:
- Diet indicators
- Known allergens
- Unknown allergen status

PROVENANCE:
- Source type
- Source URL / ID
- Last checked date
- Verified versus estimated fields
- Unknown fields

Different information may have different
provenance within the same food record.

Use appropriate adapters to convert source data
into the existing decision-engine contract.

Do not blindly replace the current catalog.

Preserve the working demo.

Keep sourced data clearly separate from the
existing illustrative demo records.

Do not mark an entire record as fully verified
merely because one nutrient field is sourced.


------------------------------------------------------------
6D. DATASET SIZE AND SCOPE
------------------------------------------------------------

Do not attempt to ingest thousands of foods.

Create a small, high-quality representative
dataset sufficient to test the architecture.

TARGET:

Approximately 3–5 Cook recipes.

Approximately 3–5 actual UW on-campus menu items.

These are targets, not quotas.

Do not invent or mislabel records to reach them.

Prefer fewer verified records over many inaccurate
ones.

For Cook recipes:

Use actual ingredient quantities and carefully
matched nutritional records.

For UW dining:

Use actual published menu items and preserve
their published nutritional limitations.

Do not generate invented nutritional records
using Gemini.

Do not automatically overwrite the frontend's
existing demo catalog.

Test the sourced records through the existing
decision engine without requiring frontend changes.


============================================================
7. DECISION ENGINE RESPONSIBILITIES
============================================================

The recommendation pipeline should remain:

CANDIDATES
    |
    v
HARD CONSTRAINT FILTER
    |
    v
FEASIBLE CANDIDATES
    |
    v
EXISTING SIMPLE RANKING
    |
    v
EXPLAINABLE RECOMMENDATIONS

Hard constraints include:

- Dietary restrictions
- Allergens
- Strict budget
- Available ingredients
- Cooking equipment
- Meal duration
- Calendar conflicts
- Venue hours
- Unknown required feasibility data

A strong preference score must never override
a hard constraint.

Do not relax restrictions just to return
a recommendation.

If a required fact is unknown, preserve the
uncertainty and do not falsely mark the candidate
as confirmed feasible.

IMPORTANT:

In this phase, use the current simple ranking
strategy.

Do NOT implement the full weighted
personalization system.

Do NOT implement machine-learning ranking.

Do NOT introduce vector embeddings.

Do NOT build a new recommendation model.

Do NOT train a model.

Advanced ranking and learning from user behavior
are reserved for a later iteration.


============================================================
8. TESTING AND QUALITY REQUIREMENTS
============================================================

Add focused tests for Phase 1 and Phase 2.

PHASE 1 TESTS:

- Valid structured Gemini intent
- Invalid structured intent
- Unexpected fields
- Invalid type and range
- Valid Cook selection
- Valid Eat out selection
- Compare mode
- Protein sorting
- Budget changes
- Available-time changes
- No feasible candidates
- Existing restrictions remain enforced
- Existing state remains unchanged
- Existing meal plan remains unchanged
- API failure handling
- Deterministic fallback behavior

PHASE 2 TESTS:

- USDA record normalization
- Correct nutrient units
- Correct portion scaling
- Recipe yield scaling
- Missing nutrient handling
- Raw versus cooked ingredient distinction
- Source provenance
- Unknown price
- Unknown allergens
- Incomplete UW nutritional information
- Cook / Eat out data compatibility
- No fabricated values
- Existing catalog compatibility

Add realistic tests around incomplete data.

The system must remain honest when it lacks
necessary information.

Run:

npm test
npm run build
npm run lint

Run additional relevant tests as appropriate.

Report actual results.

If dependencies or credentials prevent testing,
document the blocker.

Do not claim that tests passed if they were not run.


============================================================
9. STRICT IMPLEMENTATION BOUNDARIES
============================================================

The following are OUT OF SCOPE for this run:

- Full frontend integration
- UI redesign
- Automatic purchasing
- Restaurant reservations
- Real-time delivery ordering
- Off-campus restaurant discovery
- Nationwide food database
- Google Places integration
- DoorDash / Uber Eats integration
- Automatic calendar modification
- Persistent background automation
- Advanced weighted ranking
- Training a personalized recommendation model
- Full fitness planning
- Study planning
- Multi-agent architecture
- MongoDB migration
- Unrelated sponsor integrations
- Rewriting Saurav's Gemini backend
- Replacing existing working application architecture

Do not expand into these features.

If you discover useful future improvements,
document them in a concise backlog.

Do not implement them.


============================================================
10. EXECUTION ORDER
============================================================

Follow this order strictly.

STEP 0 — INSPECT

Inspect the repository, branches, dependencies,
existing decision engine, current Gemini code,
food records, and tests.

Identify existing functionality and conflicts.

STEP 1 — IMPLEMENT THE GEMINI INTENT BRIDGE

Build the validation layer.

Build the preview-state integration.

Add tests.

Verify the existing engine still works.

Do not modify Saurav's backend.

STEP 2 — IMPLEMENT THE SOURCED FOOD-DATA FOUNDATION

Inspect USDA and UW HFS sources.

Define or reuse suitable data contracts.

Build minimal source adapters.

Prepare a small curated dataset.

Add nutrition normalization and provenance tests.

Verify representative source-backed records work
with the existing decision engine.

STEP 3 — VALIDATE

Run focused tests.

Run the existing test suite.

Run build and lint.

Inspect the diff for unrelated modifications.

Confirm no teammate-owned files were changed.

STEP 4 — HANDOFF

Provide:

- Changed files
- Implementation summary
- Test results
- Remaining issues
- Integration requirements for Saurav
- Integration requirements for frontend teammates
- Source coverage and missing fields
- Exact branch and commit information

Commit task-owned changes on the dedicated branch
if repository access permits.

Do not merge into main.


============================================================
11. EXACT STOP CONDITIONS
============================================================

THIS IS THE MOST IMPORTANT SECTION.

Stop development when all of the following are
completed or their blockers have been documented:

1. The Gemini structured-intent validation layer
   is implemented and independently testable.

2. Validated intent can be passed to the existing
   recommendation engine using a temporary state.

3. Unauthorized AI output cannot modify persistent
   application state.

4. A minimal USDA-based ingredient nutrition workflow
   or verified-data adapter is implemented.

5. A small source-backed UW on-campus food dataset
   is prepared, with honest field-level provenance.

6. Representative Cook and Eat out records can be
   evaluated through the existing decision engine.

7. Focused tests are implemented.

8. Existing tests, build, and lint have been
   attempted and actual outcomes reported.

9. Teammate integration requirements are documented.

10. Changes are isolated to a safe development branch
    or provided as an applicable patch if writing
    to GitHub is unavailable.

STOP HERE.

Do not continue automatically into:

- Frontend integration
- More restaurant coverage
- Full database population
- Advanced personalization
- Weighted scoring
- New sponsor integrations
- Additional application features

Do not begin another development phase simply
because there is time remaining.

If the scope is complete, stop and report.

If blocked by missing credentials, source access,
or teammate-owned interfaces:

- Complete independent work.
- Report the exact blocker.
- Explain the smallest next action.
- Stop rather than inventing functionality.


============================================================
12. FINAL REPORT FORMAT
============================================================

At completion, provide a concise report:

A. WHAT WAS IMPLEMENTED

Explain the actual modules and behavior.

B. SOURCE COVERAGE

List:
- USDA records covered
- UW campus menu items covered
- Verified versus estimated information
- Missing information

C. TEST RESULTS

State exact passing/failing checks.

D. GIT STATUS

State:
- Branch
- Commit
- Changed files
- PR status
- Any conflicts

E. TEAM HANDOFF

Clearly explain:

What Saurav needs to implement or expose.

What the frontend team needs to connect.

What Kevin should do next.

F. NEXT DEVELOPMENT PHASE

Recommend the next small implementation task.

Do not execute it.


============================================================
13. WORKING STYLE
============================================================

Implement, do not merely produce another plan.

Start with a short repository inspection and
implementation plan.

Then perform the work.

Prioritize correctness, integration compatibility,
and hackathon completion.

Keep the architecture simple.

Do not build abstractions without real use cases.

Make reasonable reversible decisions independently.

Keep changes narrow and testable.

Preserve all teammates' work.

If a feature cannot be completed honestly,
report the limitation instead of pretending it works.

DELIVERABLE FOR THIS RUN:

A working, tested Gemini-to-Decision-Engine bridge
and a small, trustworthy USDA + UW HFS food-data
foundation, without modifying teammates'
application features.

STOP after completing this deliverable.

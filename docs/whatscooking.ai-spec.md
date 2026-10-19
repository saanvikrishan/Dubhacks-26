# whatscooking.ai Specification
## An Agentic Culinary Assistant for University Students

**Version:** 1.0  
**Date:** October 17, 2026  
**Target Stack:** Next.js 14+, TypeScript, Tailwind CSS, shadcn/ui, Sanity CMS

---

## Executive Summary

whatscooking.ai is an intelligent, context-aware AI cooking agent designed to help university students manage their food, budget, and time. It combines social media recipe transcription, smart inventory management, context-aware meal scheduling, AI-driven meal planning, dynamic cooking assistance, and fallback takeout routing into a unified platform.

**Migration Context:** This spec outlines the migration from the current React + Vite "whatscooking.ai" application to a production-ready Next.js application with significantly expanded AI agent capabilities.

### Current Implementation Status

The **whatscooking.ai** app already has a solid foundation with ~35% of the final vision complete:

✅ **Working Features:**
- Apple Calendar integration (Swift EventKit bridge)
- ICS calendar import with recurrence support
- Meal feasibility engine (dietary, budget, time, ingredients)
- Swipe-based recipe discovery
- Real UW dining venue data
- Basic nutrition tracking (6 nutrients)
- Meal logging with undo
- Pantry inventory tracking
- 35 automated tests passing

🚧 **Needs Enhancement:**
- Expand from 6 to 20+ tracked nutrients with custom goals
- Add receipt OCR and fridge scanner
- Add expiration warnings and weekly/monthly budgets
- Add Google Calendar alongside Apple Calendar

❌ **New Features to Build:**
- Social media video transcription (Instagram/TikTok/YouTube)
- Computer vision fridge scanner
- Dynamic ingredient substitutions during cooking
- Context-aware push notifications
- Taste profile training (Tinder-style swipes)
- Takeout fallback with map integration
- Multi-user authentication
- Sanity CMS migration

**See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for detailed feature breakdown.**

---

## 1. REQUIREMENTS (EARS Notation)

### 1.1 Social Media Recipe Transcriber (The Insta-Import)

**REQ-1.1.1** WHEN a user pastes a URL from Instagram Reel, TikTok, or YouTube Short, the system SHALL extract the video content and parse it using multimodal AI.

**REQ-1.1.2** WHERE the video contains spoken or on-screen recipe instructions, the system SHALL transcribe them into a structured recipe format containing name, ingredients with measurements, and step-by-step instructions.

**REQ-1.1.3** IF the video lacks explicit measurements or complete steps, the system SHALL use AI inference to generate plausible measurements and complete steps based on culinary knowledge and visual cues.

**REQ-1.1.4** WHILE processing a video, the system SHALL display a loading state with progress indication.

**REQ-1.1.5** IF video processing fails, the system SHALL notify the user with a specific error message and offer retry or manual entry options.

**REQ-1.1.6** WHEN a recipe is successfully transcribed, the system SHALL save it to the user's personal recipe collection in Sanity CMS with source attribution.

**REQ-1.1.7** WHERE measurement units are ambiguous or non-standard, the system SHALL normalize them to standard units (cups, tablespoons, grams, etc.).

### 1.2 Smart Inventory & Budgeting ("Save My Fridge")

**REQ-1.2.1** WHEN a user uploads a receipt image (photo or PDF), the system SHALL extract ingredient names, quantities, prices, and purchase date using OCR and AI parsing.

**REQ-1.2.2** WHEN a user activates the Fridge Scanner, the system SHALL use device camera to capture an image of fridge contents and identify all visible food items using computer vision.

**REQ-1.2.3** WHERE the Fridge Scanner detects food items, the system SHALL extract item names, estimated quantities, and suggest expiration dates based on typical shelf life.

**REQ-1.2.4** IF the Fridge Scanner cannot confidently identify an item (confidence < 70%), the system SHALL prompt the user for confirmation or manual correction.

**REQ-1.2.5** WHILE the Fridge Scanner processes an image, the system SHALL display a loading indicator and show detected items progressively as they are identified.

**REQ-1.2.6** WHERE manual entry is preferred, the system SHALL provide a form for ingredient name, quantity, expiration date, category, and price.

**REQ-1.2.7** WHILE inventory items are stored, the system SHALL track purchase date, expiration date, quantity remaining, and cost.

**REQ-1.2.8** WHEN an item is within 3 days of expiration, the system SHALL flag it with a "Use Soon" warning badge.

**REQ-1.2.9** WHERE items have expired, the system SHALL mark them as expired and suggest removal or usage priority.

**REQ-1.2.10** IF a user sets a weekly or monthly budget, the system SHALL track cumulative food spending against that budget.

**REQ-1.2.11** WHEN spending exceeds 80% of budget, the system SHALL display a warning notification.

**REQ-1.2.12** WHERE budget is exceeded, the system SHALL restrict meal recommendations to lower-cost options or suggest using existing inventory.

**REQ-1.2.13** WHILE items are used in recipes, the system SHALL automatically decrement inventory quantities.

### 1.3 Context-Aware Meal Scheduler & Alert System

**REQ-1.3.1** WHEN a user selects an energy level ("Exhausted," "10 Mins," "Can Cook"), the system SHALL filter recipes by maximum preparation + cooking time accordingly.

**REQ-1.3.2** WHERE the user has connected their Google Calendar or Apple Calendar, the system SHALL read daily events and identify free time blocks.

**REQ-1.3.3** WHEN using Google Calendar, the system SHALL authenticate via OAuth 2.0 and sync events bidirectionally (read events, write meal plans).

**REQ-1.3.4** WHEN using Apple Calendar (macOS/iOS), the system SHALL request EventKit permissions and read events locally without external server access.

**REQ-1.3.5** IF a user connects both Google and Apple calendars, the system SHALL merge events from both sources and de-duplicate identical events.

**REQ-1.3.6** IF a meal plan is created, the system SHALL automatically slot prep/cook/eating time into available free blocks before the target meal time.

**REQ-1.3.7** WHILE meal prep spans multiple activities (thawing, marinating, cooking), the system SHALL schedule each phase into appropriate time windows.

**REQ-1.3.8** WHEN a scheduled meal prep time approaches, the system SHALL send a push notification (if enabled).

**REQ-1.3.9** WHERE a notification includes action steps (e.g., "Thaw chicken now"), the system SHALL include actionable text and deep links to the recipe.

**REQ-1.3.10** IF the user's calendar changes and conflicts with a meal plan, the system SHALL notify the user and suggest rescheduling.

**REQ-1.3.11** WHERE a user opts to write meal plans back to their calendar, the system SHALL create calendar events with proper title, time, and location details.

**REQ-1.3.12** Energy level mappings:
- **Exhausted:** 0–5 minutes (no cooking, takeout only)
- **10 Mins:** 5–15 minutes (quick assembly, minimal cooking)
- **Can Cook:** 15–60 minutes (full cooking allowed)

### 1.4 AI Diet Architect & Nutrient Tracker

**REQ-1.4.1** WHEN a new user onboards, the system SHALL present a Tinder-style swipe interface with food images.

**REQ-1.4.2** WHERE the user swipes right (like) or left (dislike), the system SHALL record taste preferences and train a personalized taste profile.

**REQ-1.4.3** WHILE generating meal plans, the system SHALL prioritize recipes that match the user's taste profile, budget, and existing inventory.

**REQ-1.4.4** IF a user specifies dietary restrictions (vegetarian, vegan, gluten-free, etc.), the system SHALL exclude incompatible recipes from recommendations.

**REQ-1.4.5** WHEN setting up nutrient tracking preferences, the system SHALL allow users to select from a comprehensive list of nutrients including:
- Macronutrients: calories, protein, carbohydrates, total fat, saturated fat, trans fat, fiber, sugar
- Minerals: sodium, potassium, calcium, iron, magnesium, zinc, phosphorus, selenium
- Vitamins: A, C, D, E, K, B1 (thiamin), B2 (riboflavin), B3 (niacin), B6, B12, folate
- Other: cholesterol, omega-3 fatty acids, caffeine, alcohol

**REQ-1.4.6** WHERE a user selects specific nutrients to track, the system SHALL display only those nutrients in daily summaries, progress dashboards, and recipe cards.

**REQ-1.4.7** IF a user has specific health goals (muscle building, weight loss, heart health, bone health, etc.), the system SHALL suggest nutrient tracking presets with appropriate targets and explanations.

**REQ-1.4.8** WHEN a user sets a nutrient goal, the system SHALL support three goal types:
- Minimum threshold (e.g., "At least 50g protein")
- Maximum limit (e.g., "No more than 2000mg sodium")
- Target range (e.g., "Between 2000-2500 calories")

**REQ-1.4.9** WHILE a user has multiple nutrient goals active, the system SHALL allow prioritization (high, medium, low) to weight recommendations accordingly.

**REQ-1.4.10** WHEN a meal is logged as consumed, the system SHALL automatically calculate and log all user-selected tracked nutrients.

**REQ-1.4.11** WHERE nutritional data is incomplete for tracked nutrients, the system SHALL use USDA FoodData Central API to supplement missing values and mark confidence level.

**REQ-1.4.12** WHILE tracking nutrition, the system SHALL display daily totals with color-coded progress bars:
- Green: Within target range or meeting goal
- Yellow: 80-100% of maximum limit or 50-80% of minimum threshold
- Red: Exceeded maximum or below 50% of minimum

**REQ-1.4.13** IF daily goals are not met by evening, the system SHALL suggest specific meals or foods to fill nutritional gaps (e.g., "You need 15g more protein - try Greek yogurt").

**REQ-1.4.14** WHEN viewing nutrition history, the system SHALL provide weekly and monthly trend charts for each tracked nutrient with insights.

### 1.5 Dynamic Execution Agent ("I Don't Have That")

**REQ-1.5.1** WHEN a user is following a recipe and reports a missing ingredient, the system SHALL suggest suitable substitutions based on available inventory.

**REQ-1.5.2** WHERE a substitution changes cooking time or technique, the system SHALL dynamically recalculate and update the recipe steps.

**REQ-1.5.3** IF no suitable substitution exists, the system SHALL suggest omitting the ingredient and adjust the recipe accordingly.

**REQ-1.5.4** WHILE substituting, the system SHALL re-calculate nutritional values based on the new ingredients.

**REQ-1.5.5** WHEN a substitution is made, the system SHALL save the modified recipe as a new variant for future reference.

**REQ-1.5.6** WHERE multiple ingredients are missing, the system SHALL handle cascading substitutions without restarting the cooking session.

### 1.6 The Fallback Map (Takeout Routing)

**REQ-1.6.1** WHEN a user sets energy level to "Exhausted" (Zero), the system SHALL switch from recipe recommendations to a map view.

**REQ-1.6.2** WHERE the user's location is available, the system SHALL display nearby takeout options using Google Maps API.

**REQ-1.6.3** WHILE displaying takeout options, the system SHALL filter by remaining weekly/monthly budget.

**REQ-1.6.4** IF macro goals are defined, the system SHALL prioritize venues with menu items that align with those goals (e.g., high protein, low carb).

**REQ-1.6.5** WHEN a venue is selected, the system SHALL provide walking/driving directions and estimated travel time.

**REQ-1.6.6** WHERE venue menu data is available via integration (Yelp, Google Places), the system SHALL display it; otherwise, SHALL provide a link to the venue's website or Google Maps.

**REQ-1.6.7** IF the user logs a takeout meal, the system SHALL prompt for nutrition estimation or allow manual entry.

---

## 2. TECHNICAL DESIGN

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Application                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  App Router  │  │ Server       │  │  API Routes  │      │
│  │  Pages       │  │ Components   │  │              │      │
│  │  (UI Layer)  │  │  (RSC)       │  │  /api/*      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
   ┌────────────┐     ┌────────────┐    ┌────────────┐
   │   Sanity   │     │  External  │    │  Browser   │
   │    CMS     │     │  Services  │    │  Storage   │
   │            │     │            │    │ (IndexedDB)│
   └────────────┘     └────────────┘    └────────────┘
         │                   │
         │            ┌──────┴──────┐
         │            │             │
         ▼            ▼             ▼
   User Recipes   Gemini API   Google Maps
   Inventory      OpenAI       Calendar APIs
   Meal Plans     USDA Food    Push Service
   Preferences    OCR Service
```

**Key Architectural Decisions:**

1. **Next.js App Router**: Server-side rendering for performance, SEO, and reduced client bundle size
2. **Sanity CMS**: Headless CMS for user-generated recipes, inventory, and preferences with real-time sync
3. **TypeScript**: Full type safety across frontend and backend
4. **Tailwind CSS + shadcn/ui**: Consistent, accessible UI components
5. **AI Services**: Gemini/OpenAI for video transcription, substitution logic, and intelligent recommendations
6. **Google Maps API**: Geolocation, nearby search, and routing
7. **Progressive Web App (PWA)**: Installable, offline-capable, push notifications

### 2.2 Data Model (TypeScript Interfaces)

#### 2.2.1 Core Domain Types

```typescript
// types/user.ts
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  preferences: UserPreferences;
  tasteProfile: TasteProfile;
}

export interface UserPreferences {
  dietaryRestrictions: DietaryRestriction[];
  allergens: string[];
  equipment: Equipment[];
  energyLevel: EnergyLevel;
  weeklyBudget: number | null;
  monthlyBudget: number | null;
  nutritionGoals: NutritionGoal[];
  notificationsEnabled: boolean;
  location?: Coordinates;
}

export type DietaryRestriction = 
  | "vegetarian" 
  | "vegan" 
  | "gluten-free" 
  | "dairy-free" 
  | "nut-free" 
  | "halal" 
  | "kosher";

export type EnergyLevel = "exhausted" | "10mins" | "canCook";

export interface Equipment {
  id: string;
  name: string;
  available: boolean;
}

export interface NutritionGoal {
  nutrient: Nutrient;
  mode: "minimum" | "maximum" | "target_range";
  value: number;
  upper?: number; // for target_range mode
}

export type Nutrient = 
  | "energy_kcal" 
  | "protein_g" 
  | "carbohydrate_g" 
  | "fat_g" 
  | "fiber_g" 
  | "sodium_mg"
  | "vitamin_c_mg"
  | "calcium_mg"
  | "iron_mg";

export interface TasteProfile {
  likes: string[]; // ingredient/dish IDs
  dislikes: string[]; // ingredient/dish IDs
  preferredCuisines: string[];
  avoidedCuisines: string[];
  spiceLevel: 0 | 1 | 2 | 3 | 4 | 5; // 0 = none, 5 = very spicy
  trainingComplete: boolean;
}

export interface Coordinates {
  lat: number;
  lng: number;
}
```

#### 2.2.2 Recipe Types

```typescript
// types/recipe.ts
export interface Recipe {
  id: string;
  name: string;
  description: string;
  source: RecipeSource;
  sourceUrl?: string;
  imageUrl: string;
  servings: number;
  prepTime: number; // minutes
  cookTime: number; // minutes
  totalTime: number; // minutes
  difficulty: "easy" | "medium" | "hard";
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  nutrition: NutritionInfo;
  dietaryTags: DietaryRestriction[];
  allergens: string[];
  requiredEquipment: Equipment[];
  estimatedCost: number;
  cuisineType: string;
  mealType: ("breakfast" | "lunch" | "dinner" | "snack")[];
  createdAt: Date;
  updatedAt: Date;
  userId?: string; // if user-created
  isPublic: boolean;
}

export interface RecipeSource {
  type: "social_media" | "manual" | "imported" | "catalog";
  platform?: "instagram" | "tiktok" | "youtube" | "website";
  transcribedAt?: Date;
  videoUrl?: string;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  amount: number;
  unit: MeasurementUnit;
  optional: boolean;
  notes?: string;
  substitutions?: IngredientSubstitution[];
}

export type MeasurementUnit = 
  | "cup" | "tablespoon" | "teaspoon" 
  | "gram" | "kilogram" | "ounce" | "pound" 
  | "milliliter" | "liter" 
  | "piece" | "whole" | "pinch" | "to_taste";

export interface IngredientSubstitution {
  ingredientName: string;
  amount: number;
  unit: MeasurementUnit;
  notes: string;
}

export interface RecipeStep {
  order: number;
  instruction: string;
  duration?: number; // minutes
  imageUrl?: string;
  timer?: boolean;
}

export interface NutritionInfo {
  basis: "per_serving" | "per_100g" | "per_recipe";
  servings?: number;
  values: Record<Nutrient, number | null>;
  source: "calculated" | "usda" | "manual" | "estimated";
  confidence: "high" | "medium" | "low";
  updatedAt: Date;
}
```

#### 2.2.3 Inventory Types

```typescript
// types/inventory.ts
export interface InventoryItem {
  id: string;
  userId: string;
  name: string;
  category: FoodCategory;
  quantity: number;
  unit: MeasurementUnit;
  purchaseDate: Date;
  expirationDate?: Date;
  price?: number;
  location: StorageLocation;
  barcode?: string;
  imageUrl?: string;
  status: InventoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type FoodCategory = 
  | "produce" 
  | "dairy" 
  | "meat" 
  | "grains" 
  | "canned" 
  | "frozen" 
  | "spices" 
  | "condiments" 
  | "beverages"
  | "other";

export type StorageLocation = "fridge" | "freezer" | "pantry" | "counter";

export type InventoryStatus = 
  | "fresh" 
  | "use_soon" // within 3 days
  | "expired" 
  | "low_stock"; // quantity below threshold

export interface ReceiptParseResult {
  items: ReceiptItem[];
  totalAmount: number;
  purchaseDate: Date;
  storeName?: string;
  confidence: number; // 0-1
}

export interface ReceiptItem {
  name: string;
  quantity?: number;
  unit?: MeasurementUnit;
  price: number;
  matchedInventoryItem?: string; // ID if matched to existing item
}
```

#### 2.2.4 Meal Planning Types

```typescript
// types/meal-plan.ts
export interface MealPlan {
  id: string;
  userId: string;
  date: string; // ISO date string
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  recipeId: string;
  servings: number;
  scheduledTime?: string; // ISO datetime
  prepStartTime?: string; // ISO datetime - when to start prep
  status: MealPlanStatus;
  notificationsSent: NotificationLog[];
  createdAt: Date;
  updatedAt: Date;
}

export type MealPlanStatus = 
  | "planned" 
  | "prep_started" 
  | "cooking" 
  | "completed" 
  | "skipped" 
  | "takeout_fallback";

export interface NotificationLog {
  type: "prep_reminder" | "cook_start" | "meal_ready";
  sentAt: Date;
  delivered: boolean;
}

export interface MealLog {
  id: string;
  userId: string;
  date: string; // ISO date string
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  source: "recipe" | "takeout" | "manual";
  recipeId?: string;
  servings?: number;
  venueId?: string;
  venueName?: string;
  nutrition: Record<Nutrient, number | null>;
  cost?: number;
  notes?: string;
  imageUrl?: string;
  createdAt: Date;
}
```

#### 2.2.5 Calendar Integration Types

```typescript
// types/calendar.ts
export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  busy: boolean; // blocks meal planning time
  source: "google" | "apple" | "manual" | "meal_plan";
  externalId?: string; // ID from external calendar
  recurrence?: RecurrenceRule;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  until?: Date;
  byDay?: number[]; // 0=Sunday, 6=Saturday
}

export interface FreeTimeBlock {
  start: Date;
  end: Date;
  durationMinutes: number;
  location?: string;
}
```

#### 2.2.6 Takeout & Venues

```typescript
// types/venue.ts
export interface Venue {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  phone?: string;
  website?: string;
  placeId?: string; // Google Places ID
  cuisine: string[];
  priceLevel: 1 | 2 | 3 | 4; // $ to $$$$
  rating?: number;
  userRatingsTotal?: number;
  openingHours?: OpeningHours;
  photos?: VenuePhoto[];
  menuUrl?: string;
  distance?: number; // meters from user
  estimatedMenuItems?: MenuItem[];
}

export interface OpeningHours {
  openNow: boolean;
  periods: OpeningPeriod[];
  weekdayText: string[];
}

export interface OpeningPeriod {
  open: { day: number; time: string }; // day: 0=Sunday
  close: { day: number; time: string };
}

export interface VenuePhoto {
  url: string;
  width: number;
  height: number;
  attributions: string[];
}

export interface MenuItem {
  name: string;
  description?: string;
  price?: number;
  nutrition?: Partial<Record<Nutrient, number>>;
  dietary?: DietaryRestriction[];
}
```

#### 2.2.7 AI Agent Types

```typescript
// types/agent.ts
export interface VideoTranscriptionRequest {
  url: string;
  platform: "instagram" | "tiktok" | "youtube";
  userId: string;
}

export interface VideoTranscriptionResult {
  success: boolean;
  recipe?: Recipe;
  error?: string;
  confidence: number;
  processingTimeMs: number;
  warnings: string[];
}

export interface SubstitutionRequest {
  recipeId: string;
  missingIngredientId: string;
  availableInventory: InventoryItem[];
}

export interface SubstitutionResult {
  substitution?: IngredientSubstitution;
  recalculatedSteps: RecipeStep[];
  nutritionDelta: Partial<Record<Nutrient, number>>;
  confidence: number;
  reasoning: string;
}

export interface MealRecommendationRequest {
  userId: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  targetDate: string;
  energyLevel: EnergyLevel;
  availableTime: number; // minutes
  inventory: InventoryItem[];
  tasteProfile: TasteProfile;
  budgetRemaining: number;
  nutritionGoals: NutritionGoal[];
  previousMeals: MealLog[]; // for variety
}

export interface MealRecommendationResult {
  recipes: ScoredRecipe[];
  reasoning: string;
}

export interface ScoredRecipe {
  recipe: Recipe;
  score: number;
  reasons: RecommendationReason[];
  feasibility: FeasibilityCheck;
}

export interface RecommendationReason {
  type: "taste_match" | "budget" | "time" | "inventory_usage" | "nutrition" | "variety";
  description: string;
  weight: number;
}

export interface FeasibilityCheck {
  feasible: boolean;
  issues: FeasibilityIssue[];
  inventoryCoverage: number; // 0-1, percentage of ingredients available
  budgetFit: boolean;
  timeFit: boolean;
  equipmentFit: boolean;
  dietaryFit: boolean;
}

export interface FeasibilityIssue {
  type: "missing_ingredient" | "over_budget" | "insufficient_time" | "missing_equipment" | "dietary_conflict";
  description: string;
  severity: "blocking" | "warning";
}
```

### 2.3 API Design

#### 2.3.1 API Routes Structure

```
/api
├── auth
│   ├── login
│   ├── logout
│   ├── register
│   └── session
├── recipes
│   ├── [id]
│   ├── search
│   ├── transcribe      (POST video URL)
│   ├── recommend       (POST recommendation request)
│   └── substitute      (POST substitution request)
├── inventory
│   ├── [id]
│   ├── list
│   ├── add
│   ├── update
│   ├── delete
│   ├── parse-receipt   (POST image/PDF)
│   └── expiring        (GET items near expiration)
├── meal-plans
│   ├── [id]
│   ├── list
│   ├── create
│   ├── update
│   ├── delete
│   └── schedule        (POST auto-schedule request)
├── meal-logs
│   ├── [id]
│   ├── list
│   ├── create
│   ├── daily-nutrition (GET aggregated nutrition)
│   └── update
├── calendar
│   ├── events
│   ├── sync            (POST sync with external calendar)
│   ├── free-blocks     (GET available time blocks)
│   └── [id]
├── venues
│   ├── nearby          (GET with lat/lng params)
│   ├── [id]
│   └── search
├── preferences
│   ├── get
│   ├── update
│   └── taste-profile
│       ├── get
│       ├── swipe       (POST like/dislike)
│       └── complete
├── budget
│   ├── summary
│   ├── spending
│   └── forecast
└── notifications
    ├── register        (POST push subscription)
    ├── send
    └── test
```

#### 2.3.2 Key API Endpoints

**POST /api/recipes/transcribe**
```typescript
// Request
{
  url: string;
  platform: "instagram" | "tiktok" | "youtube";
}

// Response
{
  success: boolean;
  recipe?: Recipe;
  error?: string;
  warnings: string[];
}
```

**POST /api/recipes/recommend**
```typescript
// Request: MealRecommendationRequest

// Response: MealRecommendationResult
```

**POST /api/recipes/substitute**
```typescript
// Request: SubstitutionRequest

// Response: SubstitutionResult
```

**POST /api/inventory/parse-receipt**
```typescript
// Request: FormData with image/PDF file

// Response
{
  success: boolean;
  result?: ReceiptParseResult;
  error?: string;
}
```

**GET /api/meal-logs/daily-nutrition?date=YYYY-MM-DD**
```typescript
// Response
{
  date: string;
  meals: MealLog[];
  totals: Record<Nutrient, number>;
  goals: NutritionGoal[];
  goalStatus: Record<string, {
    current: number;
    target: number;
    percentage: number;
    met: boolean;
  }>;
}
```

**POST /api/meal-plans/schedule**
```typescript
// Request
{
  recipeId: string;
  targetMealTime: string; // ISO datetime
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
}

// Response
{
  success: boolean;
  mealPlan?: MealPlan;
  prepStartTime: string;
  notifications: {
    type: string;
    scheduledFor: string;
  }[];
  conflicts?: CalendarEvent[];
}
```

**GET /api/venues/nearby?lat=X&lng=Y&budget=Z**
```typescript
// Response
{
  venues: Venue[];
  userLocation: Coordinates;
  budgetRemaining: number;
}
```

### 2.4 Data Flow Diagrams

#### 2.4.1 Video Recipe Transcription Flow

```
User pastes URL
     │
     ▼
Frontend validates URL
     │
     ▼
POST /api/recipes/transcribe
     │
     ▼
Download video (server-side)
     │
     ▼
Extract frames + audio
     │
     ▼
Gemini/GPT-4V multimodal analysis
  - OCR on-screen text
  - Transcribe audio
  - Identify ingredients visually
  - Infer measurements/steps
     │
     ▼
Structured recipe JSON
     │
     ▼
Validate + normalize units
     │
     ▼
Save to Sanity CMS
     │
     ▼
Return recipe to frontend
     │
     ▼
Display in UI with "Transcribed" badge
```

#### 2.4.2 Dynamic Substitution Flow

```
User clicks "I don't have [ingredient]"
     │
     ▼
Frontend sends SubstitutionRequest
     │
     ▼
POST /api/recipes/substitute
     │
     ▼
AI analyzes:
  - Recipe context (cuisine, role of ingredient)
  - User's inventory
  - Nutritional similarity
  - Cooking properties
     │
     ▼
Generate substitution options
     │
     ▼
Recalculate recipe steps if needed
  (e.g., different cooking time)
     │
     ▼
Return substitution + modified steps
     │
     ▼
Frontend updates recipe in real-time
     │
     ▼
User continues cooking with new ingredient
```

#### 2.4.3 Context-Aware Meal Scheduling Flow

```
User selects "Plan a meal"
     │
     ▼
System fetches calendar events
     │
     ▼
Identify free time blocks
     │
     ▼
User chooses recipe
     │
     ▼
POST /api/meal-plans/schedule
     │
     ▼
Calculate prep + cook + eat time
     │
     ▼
Find suitable free block before target meal time
     │
     ▼
Check for conflicts
     │
     ├─ Conflict found
     │  └─> Suggest alternative time
     │
     └─ No conflict
        └─> Create meal plan
            │
            ▼
        Schedule notifications:
          - "Start thawing" (if needed)
          - "Start prep" (prep time before)
          - "Start cooking" (at cook time)
          - "Meal ready" (at completion)
            │
            ▼
        Save to database
            │
            ▼
        Return confirmation to user
```

### 2.5 Technology Stack Details

| Layer | Technology | Justification |
|-------|------------|---------------|
| **Framework** | Next.js 14+ (App Router) | Server components, streaming, optimized bundling, API routes |
| **Language** | TypeScript 5+ | Type safety, better DX, fewer runtime errors |
| **UI Library** | React 18+ | Component-based, widespread ecosystem |
| **Styling** | Tailwind CSS 3+ | Utility-first, rapid development, small bundle |
| **Component Library** | shadcn/ui | Accessible, customizable, copy-paste components |
| **Backend/CMS** | Sanity CMS | Real-time sync, flexible schema, great DX, image CDN |
| **Database** | Sanity (primary), Vercel Postgres (optional) | Managed, scalable, serverless |
| **Auth** | NextAuth.js | Provider flexibility, session management |
| **AI/ML** | Google Gemini 2.5 Flash + Pro | Multimodal video, fast inference, structured output |
| **OCR** | Google Cloud Vision API | Receipt parsing, ingredient extraction |
| **Nutrition Data** | USDA FoodData Central API | Authoritative, comprehensive, free |
| **Maps** | Google Maps JavaScript API | Places, geocoding, directions |
| **Calendar** | Google Calendar API | OAuth, read/write events |
| **Push Notifications** | Web Push API + Vercel Cron | Standards-based, server-triggered |
| **State Management** | React Context + SWR | Server state caching, optimistic updates |
| **Form Validation** | Zod | TypeScript-first schema validation |
| **Testing** | Vitest + React Testing Library | Fast, compatible with Vite |
| **Deployment** | Vercel | Native Next.js support, edge functions, analytics |

---

## 3. IMPLEMENTATION TASKS

### 3.1 Phase 0: Project Setup & Foundation

**TASK-0.1** Initialize Next.js project with TypeScript and App Router
- Create Next.js app with `npx create-next-app@latest --typescript --app --tailwind`
- Configure `tsconfig.json` with strict mode
- Set up folder structure: `/app`, `/components`, `/lib`, `/types`, `/sanity`
- **Dependencies:** Next.js, TypeScript, Tailwind CSS
- **Estimate:** 2 hours

**TASK-0.2** Install and configure shadcn/ui
- Run `npx shadcn-ui@latest init`
- Configure `components.json` with custom theme
- Install base components: Button, Input, Card, Dialog, Dropdown, Tabs, Toast
- **Dependencies:** TASK-0.1
- **Estimate:** 1 hour

**TASK-0.3** Set up Sanity CMS project
- Create Sanity project: `npm create sanity@latest`
- Define schemas for: User, Recipe, InventoryItem, MealPlan, MealLog, Preferences
- Configure CORS to allow Next.js domain
- Set up Sanity Studio at `/studio` route
- **Dependencies:** TASK-0.1
- **Estimate:** 4 hours

**TASK-0.4** Configure authentication with NextAuth.js
- Install NextAuth.js
- Set up `/api/auth/[...nextauth]` route
- Configure Google OAuth provider
- Create session management utilities
- Protect API routes with middleware
- **Dependencies:** TASK-0.1, TASK-0.3
- **Estimate:** 3 hours

**TASK-0.5** Set up environment variables and secrets management
- Create `.env.local.example` with all required keys
- Document required API keys: GOOGLE_MAPS_API_KEY, GEMINI_API_KEY, SANITY_API_TOKEN, NEXTAUTH_SECRET, etc.
- Configure Vercel environment variables for production
- **Dependencies:** TASK-0.1
- **Estimate:** 1 hour

**TASK-0.6** Create core TypeScript types and interfaces
- Define all interfaces from Section 2.2 in `/types` directory
- Export from `/types/index.ts`
- **Dependencies:** TASK-0.1
- **Estimate:** 2 hours

**TASK-0.7** Set up global state management with React Context
- Create `UserContext` for auth state
- Create `PreferencesContext` for user preferences
- Create `InventoryContext` for inventory state
- Set up SWR for server state caching
- **Dependencies:** TASK-0.6
- **Estimate:** 2 hours

**TASK-0.8** Configure linting, formatting, and Git hooks
- Set up ESLint with Next.js config
- Add Prettier with Tailwind plugin
- Configure Husky for pre-commit hooks
- Add lint-staged for staged files only
- **Dependencies:** TASK-0.1
- **Estimate:** 1 hour

### 3.2 Phase 1: User Onboarding & Profile Management

**TASK-1.1** Design and implement landing page
- Create `/app/page.tsx` with hero section
- Add feature highlights and benefits
- Include "Get Started" CTA
- Implement responsive layout
- **Dependencies:** TASK-0.1, TASK-0.2
- **Estimate:** 3 hours

**TASK-1.2** Build sign-up flow
- Create `/app/signup/page.tsx`
- Integrate NextAuth.js registration
- Collect: name, email, password
- Implement form validation with Zod
- Add loading states and error handling
- **Dependencies:** TASK-0.4, TASK-0.2
- **Estimate:** 3 hours

**TASK-1.3** Create onboarding wizard (Step 1: Dietary Preferences)
- Create `/app/onboarding/dietary/page.tsx`
- Multi-select for dietary restrictions
- Allergen selection
- Equipment checklist
- Save to Sanity user profile
- **Dependencies:** TASK-1.2, TASK-0.3
- **Estimate:** 3 hours

**TASK-1.4** Create onboarding wizard (Step 2: Budget Setup)
- Create `/app/onboarding/budget/page.tsx`
- Input for weekly/monthly budget
- Explain budget tracking features
- Save to user preferences
- **Dependencies:** TASK-1.3
- **Estimate:** 2 hours

**TASK-1.4b** Create onboarding wizard (Step 2.5: Nutrient Tracking Preferences)
- Create `/app/onboarding/nutrients/page.tsx`
- Display comprehensive nutrient list with categories (macros, vitamins, minerals)
- Checkboxes to select which nutrients to track
- Preset buttons: "Muscle Building", "Weight Loss", "Heart Health", "General Wellness"
- For each selected nutrient, allow goal setting (min/max/range)
- Priority selector (high/medium/low) for each goal
- Explain why tracking each nutrient matters
- Save to user preferences
- **Dependencies:** TASK-1.4
- **Estimate:** 4 hours

**TASK-1.5** Create onboarding wizard (Step 3: Taste Profile Training - Swipe Interface)
- Create `/app/onboarding/taste/page.tsx`
- Implement Tinder-style swipe cards with framer-motion
- Load 20+ diverse food images
- Track likes/dislikes
- Support swipe gestures (mobile) and buttons (desktop)
- **Dependencies:** TASK-1.4b
- **Estimate:** 5 hours

**TASK-1.6** Save taste profile and generate initial recommendations
- Process swipe data into taste profile
- Calculate cuisine preferences
- Mark onboarding as complete
- Redirect to dashboard
- **Dependencies:** TASK-1.5
- **Estimate:** 2 hours

**TASK-1.7** Build user profile settings page
- Create `/app/settings/page.tsx`
- Editable preferences form
- Account management (email, password)
- Delete account option
- **Dependencies:** TASK-1.6
- **Estimate:** 3 hours

### 3.3 Phase 2: Smart Inventory Management

**TASK-2.1** Design inventory data schema in Sanity
- Define `inventoryItem` schema with all fields from Section 2.2.3
- Add validation rules
- Configure relationships to users
- **Dependencies:** TASK-0.3
- **Estimate:** 2 hours

**TASK-2.2** Build inventory list view
- Create `/app/inventory/page.tsx`
- Display items in grid/list with filters
- Color-coded status badges (fresh, use soon, expired)
- Sort by expiration date, category, name
- Search functionality
- **Dependencies:** TASK-2.1, TASK-0.2
- **Estimate:** 4 hours

**TASK-2.3** Implement manual inventory item addition
- Create "Add Item" dialog component
- Form fields: name, quantity, unit, category, expiration date, price
- Auto-suggest common items
- Save to Sanity
- Optimistic UI update
- **Dependencies:** TASK-2.2
- **Estimate:** 3 hours

**TASK-2.4** Build receipt upload UI
- Add file upload component (image + PDF support)
- Show upload progress
- Display preview of uploaded file
- **Dependencies:** TASK-2.2, TASK-0.2
- **Estimate:** 2 hours

**TASK-2.4a** Build Fridge Scanner UI
- Create `/app/inventory/scan/page.tsx`
- Implement camera access with proper permissions
- Live camera preview with capture button
- Support both front and back cameras
- Option to upload from photo library
- Loading state: "Analyzing your fridge..."
- **Dependencies:** TASK-2.2, TASK-0.2
- **Estimate:** 3 hours

**TASK-2.4b** Implement Fridge Scanner computer vision (backend)
- Create `/api/inventory/scan-fridge` endpoint
- Integrate Google Cloud Vision API for object detection
- Use Gemini Pro Vision for food item identification
- Detect multiple items in a single image
- Extract item names with confidence scores
- Estimate quantities based on visual size/count
- Suggest typical expiration dates per item type
- Return structured array of detected items
- **Dependencies:** TASK-2.4a, TASK-0.5
- **Estimate:** 6 hours

**TASK-2.4c** Build Fridge Scanner results review UI
- Display detected items in a grid with thumbnails
- Show confidence score per item (as percentage)
- Editable fields: name, quantity, expiration date
- "Remove" button for incorrect detections
- Color-coded confidence indicators (green >80%, yellow 60-80%, red <60%)
- "Scan Again" and "Add All to Inventory" buttons
- Show before/after comparison (image + detected items overlay)
- **Dependencies:** TASK-2.4b
- **Estimate:** 4 hours

**TASK-2.5** Implement receipt OCR parsing (backend)
- Create `/api/inventory/parse-receipt` endpoint
- Integrate Google Cloud Vision API for OCR
- Extract text from image/PDF
- Use Gemini to structure extracted text into receipt data
- Return parsed items array
- **Dependencies:** TASK-2.4, TASK-0.5
- **Estimate:** 5 hours

**TASK-2.6** Build receipt review & confirmation UI
- Display parsed items in editable table
- Allow user to correct names, quantities, prices
- "Add All to Inventory" button
- Error handling for failed parsing
- **Dependencies:** TASK-2.5
- **Estimate:** 3 hours

**TASK-2.7** Implement inventory item editing and deletion
- Edit dialog with pre-filled form
- Update quantity, expiration, notes
- Delete confirmation dialog
- **Dependencies:** TASK-2.2
- **Estimate:** 2 hours

**TASK-2.8** Build expiration notification system
- Create cron job to check items expiring within 3 days
- Flag items with "use_soon" status
- Display warning banner on dashboard
- **Dependencies:** TASK-2.2
- **Estimate:** 3 hours

**TASK-2.9** Implement budget tracking dashboard
- Create `/app/budget/page.tsx`
- Display weekly/monthly spending vs. budget
- Bar chart visualization
- Spending breakdown by category
- Alert when 80%+ of budget used
- **Dependencies:** TASK-2.1, TASK-1.4
- **Estimate:** 4 hours

**TASK-2.10** Auto-decrement inventory when recipe is logged as consumed
- Hook into meal logging flow
- Calculate ingredient quantities used based on servings
- Update inventory quantities in Sanity
- Handle case where quantity reaches zero
- **Dependencies:** TASK-2.1, Phase 5
- **Estimate:** 3 hours

### 3.4 Phase 3: Social Media Recipe Transcriber

**TASK-3.1** Design recipe schema in Sanity
- Define `recipe` schema with all fields from Section 2.2.2
- Include source tracking fields
- Add image upload support
- **Dependencies:** TASK-0.3
- **Estimate:** 2 hours

**TASK-3.2** Build recipe import UI
- Create `/app/recipes/import/page.tsx`
- URL input field with platform detection
- Supported platforms list
- Loading state with "Transcribing..." message
- **Dependencies:** TASK-3.1, TASK-0.2
- **Estimate:** 2 hours

**TASK-3.3** Implement video download service (backend)
- Create video downloader utility using `yt-dlp` or similar
- Support Instagram, TikTok, YouTube
- Handle authentication/cookies if needed
- Store video temporarily in `/tmp`
- **Dependencies:** TASK-3.2
- **Estimate:** 4 hours

**TASK-3.4** Implement video frame extraction
- Use `ffmpeg` to extract key frames (1 frame per second)
- Extract audio track
- **Dependencies:** TASK-3.3
- **Estimate:** 2 hours

**TASK-3.5** Implement multimodal AI transcription
- Create `/api/recipes/transcribe` endpoint
- Send frames + audio to Gemini 2.5 Flash (multimodal)
- Prompt engineering for recipe extraction
- Parse structured JSON response
- **Dependencies:** TASK-3.4, TASK-0.5
- **Estimate:** 5 hours

**TASK-3.6** Implement measurement inference and normalization
- Detect ambiguous measurements ("a little", "some")
- Use AI to infer reasonable amounts
- Normalize to standard units
- Add confidence scores
- **Dependencies:** TASK-3.5
- **Estimate:** 3 hours

**TASK-3.7** Build recipe review & editing UI
- Display transcribed recipe with editable fields
- Highlight low-confidence sections
- Allow manual corrections
- "Save to My Recipes" button
- **Dependencies:** TASK-3.5, TASK-0.2
- **Estimate:** 4 hours

**TASK-3.8** Implement error handling and retry logic
- Handle video download failures
- Detect unsupported platforms
- Provide meaningful error messages
- "Try Again" button
- Fallback to manual entry
- **Dependencies:** TASK-3.5
- **Estimate:** 2 hours

**TASK-3.9** Save transcribed recipe to Sanity
- Validate recipe structure
- Generate unique ID
- Save with source attribution
- Link to user account
- **Dependencies:** TASK-3.7, TASK-3.1
- **Estimate:** 2 hours

**TASK-3.10** Build recipe library view
- Create `/app/recipes/page.tsx`
- Display user's saved recipes
- Filter by source, cuisine, meal type
- Search functionality
- **Dependencies:** TASK-3.9
- **Estimate:** 3 hours

### 3.5 Phase 4: Calendar Integration & Free Time Detection

**TASK-4.1** Set up Google Calendar API integration
- Configure OAuth 2.0 credentials in Google Cloud Console
- Set up consent screen with appropriate scopes
- Add calendar.readonly and calendar.events scopes
- Configure redirect URIs for dev and production
- **Dependencies:** TASK-0.4, TASK-0.5
- **Estimate:** 2 hours

**TASK-4.1a** Migrate existing Apple Calendar integration from current whatscooking.ai app
- Port `server/calendar-bridge.js` to Next.js API route structure
- Port `native/CalendarBridge.swift` to work with Next.js
- Update compilation script for Swift bridge
- Test EventKit permission flow on macOS
- Preserve existing ICS import functionality
- **Dependencies:** TASK-0.1, TASK-0.5
- **Estimate:** 4 hours

**TASK-4.2** Implement multi-calendar connection UI
- Create `/app/settings/calendar/page.tsx`
- Display connection status for Google and Apple calendars
- "Connect Google Calendar" OAuth button
- "Connect Apple Calendar" button (macOS only, with platform detection)
- "Import .ics File" button
- Show last sync time for each connected source
- Allow connecting multiple sources simultaneously
- Manual refresh button for each source
- Disconnect options
- **Dependencies:** TASK-4.1, TASK-4.1a
- **Estimate:** 4 hours

**TASK-4.2a** Implement calendar source merging logic
- Deduplicate events from multiple sources (match by title + time)
- Maintain source attribution per event
- Handle conflicts (prefer user's primary calendar)
- Merge free time blocks across all sources
- Display source badges on calendar events
- **Dependencies:** TASK-4.2
- **Estimate:** 3 hours

**TASK-4.3** Build calendar event fetching (backend)
- Create `/api/calendar/events` endpoint
- Fetch events for date range
- Transform to internal format
- Cache results with SWR
- **Dependencies:** TASK-4.2
- **Estimate:** 3 hours

**TASK-4.4** Implement free time block detection algorithm
- Analyze calendar events for gaps
- Filter for blocks >= 15 minutes
- Exclude sleep hours (10 PM - 7 AM default)
- Return sorted list of free blocks
- **Dependencies:** TASK-4.3
- **Estimate:** 4 hours

**TASK-4.5** Build calendar view UI
- Create `/app/calendar/page.tsx`
- Week/day view toggle
- Display events and meal plans
- Highlight free time blocks
- **Dependencies:** TASK-4.3, TASK-0.2
- **Estimate:** 5 hours

**TASK-4.6** Implement calendar sync service
- Background sync every 15 minutes
- Update local cache
- Detect conflicts with existing meal plans
- **Dependencies:** TASK-4.3
- **Estimate:** 3 hours

### 3.6 Phase 5: AI Diet Architect & Meal Recommendations

**TASK-5.1** Build recipe recommendation engine (backend)
- Create `/api/recipes/recommend` endpoint
- Implement scoring algorithm:
  - Taste profile match (30%)
  - Budget fit (20%)
  - Inventory coverage (20%)
  - Time constraint (15%)
  - Nutrition goals (15%)
- Return top 10 ranked recipes
- **Dependencies:** TASK-3.1, TASK-2.1, TASK-1.6
- **Estimate:** 6 hours

**TASK-5.2** Integrate AI for contextual recommendations
- Use Gemini to analyze user context holistically
- Provide reasoning for recommendations
- Consider factors: weather, previous meals, variety
- **Dependencies:** TASK-5.1
- **Estimate:** 4 hours

**TASK-5.3** Build recipe discovery feed
- Create `/app/discover/page.tsx`
- Card-based layout showing recommended recipes
- Display: image, name, time, cost, match score
- Filter by meal type, cuisine
- **Dependencies:** TASK-5.1, TASK-0.2
- **Estimate:** 4 hours

**TASK-5.4** Implement recipe detail view
- Create `/app/recipes/[id]/page.tsx`
- Full recipe information
- Nutrition breakdown
- "Add to Meal Plan" button
- Inventory coverage indicator
- **Dependencies:** TASK-5.3
- **Estimate:** 3 hours

**TASK-5.5** Build comprehensive nutrition goal setting UI
- Create `/app/settings/nutrition/page.tsx`
- Organize nutrients into expandable categories:
  - Macronutrients (calories, protein, carbs, fats, fiber, sugar)
  - Vitamins (A, C, D, E, K, B-complex, folate)
  - Minerals (calcium, iron, magnesium, zinc, potassium, sodium)
  - Other (cholesterol, omega-3, caffeine)
- Checkbox to enable/disable tracking per nutrient
- For each tracked nutrient:
  - Goal type selector (minimum/maximum/range)
  - Input field(s) for target values
  - Priority selector (high/medium/low)
  - Info tooltip with RDA and health benefits
- Preset templates section with one-click apply:
  - "Muscle Building" (high protein, moderate carbs)
  - "Weight Loss" (calorie deficit, high protein)
  - "Heart Health" (low sodium, high omega-3)
  - "Bone Health" (high calcium, vitamin D)
  - "General Wellness" (balanced macros, key vitamins)
- "Custom" option for manual configuration
- Visual preview of selected goals with color coding
- Save to preferences with validation
- **Dependencies:** TASK-1.7, TASK-1.4b
- **Estimate:** 5 hours

**TASK-5.6** Implement daily nutrition tracking
- Create `/api/meal-logs/daily-nutrition` endpoint
- Aggregate nutrition from logged meals
- Calculate progress toward goals
- Return gaps and recommendations
- **Dependencies:** TASK-5.5, Phase 6
- **Estimate:** 3 hours

**TASK-5.7** Build comprehensive nutrition dashboard
- Create `/app/nutrition/page.tsx`
- Display only user's selected tracked nutrients (from preferences)
- Color-coded progress bars per nutrient:
  - Green: Meeting goal/within range
  - Yellow: 80-100% of max or 50-80% of min
  - Red: Exceeded max or below 50% of min
- Expandable cards per nutrient category
- Daily totals with goal comparison
- Weekly/monthly trend charts using recharts or similar
- Top nutrient sources section (which foods contributed most)
- Nutrient gap alerts ("You need 15g more protein today")
- Meal log history with per-meal breakdown
- Export data as CSV button
- Date range selector
- **Dependencies:** TASK-5.6
- **Estimate:** 6 hours

**TASK-5.8** Implement USDA FoodData Central integration
- Create service to query USDA API
- Search for ingredients by name
- Fetch nutrition data
- Cache results
- **Dependencies:** TASK-0.5
- **Estimate:** 3 hours

**TASK-5.9** Auto-fill recipe nutrition from ingredients
- Calculate nutrition per serving
- Sum ingredient nutrition values
- Use USDA data for missing values
- Show confidence level
- **Dependencies:** TASK-5.8, TASK-3.1
- **Estimate:** 4 hours

### 3.7 Phase 6: Meal Planning & Scheduling

**TASK-6.1** Build meal plan creation flow
- Add "Plan This Meal" button on recipe detail page
- Date + meal type picker
- Target meal time selector
- **Dependencies:** TASK-5.4
- **Estimate:** 2 hours

**TASK-6.2** Implement automatic scheduling algorithm
- Create `/api/meal-plans/schedule` endpoint
- Calculate prep + cook + eat time
- Find suitable free time block before target meal time
- Check for calendar conflicts
- **Dependencies:** TASK-4.4, TASK-6.1
- **Estimate:** 5 hours

**TASK-6.3** Handle scheduling conflicts
- If conflict found, suggest alternative times
- Show conflicting events
- Allow manual time override
- **Dependencies:** TASK-6.2
- **Estimate:** 3 hours

**TASK-6.4** Build meal plan list view
- Create `/app/meal-plans/page.tsx`
- Display upcoming meal plans
- Group by date
- Show prep start time, meal time, recipe
- **Dependencies:** TASK-6.2
- **Estimate:** 3 hours

**TASK-6.5** Implement meal plan editing and deletion
- Edit meal time
- Change recipe
- Delete meal plan
- Update inventory reservations
- **Dependencies:** TASK-6.4
- **Estimate:** 2 hours

**TASK-6.6** Build meal plan detail view with cooking mode
- Create `/app/meal-plans/[id]/cook/page.tsx`
- Step-by-step cooking interface
- Timer buttons for each step
- Progress tracker
- "I Don't Have This Ingredient" buttons
- **Dependencies:** TASK-6.4
- **Estimate:** 5 hours

### 3.8 Phase 7: Context-Aware Notifications & Alerts

**TASK-7.1** Set up Web Push API integration
- Create push notification service
- Generate VAPID keys
- Configure service worker
- **Dependencies:** TASK-0.5
- **Estimate:** 3 hours

**TASK-7.2** Build notification permission request flow
- In-app prompt to enable notifications
- Explain benefits
- Handle permission grant/deny
- **Dependencies:** TASK-7.1
- **Estimate:** 2 hours

**TASK-7.3** Implement notification registration endpoint
- Create `/api/notifications/register`
- Store push subscriptions per user
- Link to user account
- **Dependencies:** TASK-7.2
- **Estimate:** 2 hours

**TASK-7.4** Build notification scheduling system
- When meal plan is created, schedule notifications:
  - Thawing reminder (if frozen ingredients)
  - Prep start reminder
  - Cook start reminder
  - Meal ready notification
- Store scheduled notifications in database
- **Dependencies:** TASK-6.2, TASK-7.3
- **Estimate:** 4 hours

**TASK-7.5** Implement notification sending service
- Create Vercel cron job: `/api/cron/send-notifications`
- Run every minute
- Check for due notifications
- Send via Web Push API
- Mark as sent
- **Dependencies:** TASK-7.4
- **Estimate:** 3 hours

**TASK-7.6** Build notification history view
- Create `/app/notifications/page.tsx`
- List past notifications
- Filter by type, date
- "Snooze" and "Dismiss" actions
- **Dependencies:** TASK-7.5
- **Estimate:** 2 hours

**TASK-7.7** Implement notification settings
- Allow users to enable/disable notification types
- Customize reminder lead times
- Quiet hours setting
- **Dependencies:** TASK-7.6, TASK-1.7
- **Estimate:** 2 hours

### 3.9 Phase 8: Dynamic Substitution Agent

**TASK-8.1** Build substitution request UI
- In cooking mode, add "I Don't Have This" button per ingredient
- Dialog to confirm missing ingredient
- **Dependencies:** TASK-6.6
- **Estimate:** 2 hours

**TASK-8.2** Implement AI substitution logic (backend)
- Create `/api/recipes/substitute` endpoint
- Analyze ingredient role (fat, acid, protein, etc.)
- Match against user's inventory
- Use Gemini to suggest substitutions with reasoning
- **Dependencies:** TASK-8.1, TASK-2.1
- **Estimate:** 5 hours

**TASK-8.3** Recalculate recipe steps for substitutions
- Detect if cooking time/technique changes
- Generate updated step instructions
- Preserve step numbering
- **Dependencies:** TASK-8.2
- **Estimate:** 4 hours

**TASK-8.4** Update nutrition values after substitution
- Calculate nutrition delta
- Display "Modified nutrition" badge
- **Dependencies:** TASK-8.3, TASK-5.8
- **Estimate:** 3 hours

**TASK-8.5** Display substitution result in UI
- Show suggested substitution with reasoning
- "Use This Substitution" button
- Update recipe in real-time without page reload
- Save modified recipe as variant
- **Dependencies:** TASK-8.4
- **Estimate:** 3 hours

**TASK-8.6** Handle multiple substitutions in sequence
- Track all substitutions made
- Allow undo of last substitution
- Maintain substitution history per cooking session
- **Dependencies:** TASK-8.5
- **Estimate:** 3 hours

### 3.10 Phase 9: Energy Level & Quick Filters

**TASK-9.1** Build energy level selector component
- Create radial selector with three options:
  - Exhausted (0-5 min)
  - 10 Mins (5-15 min)
  - Can Cook (15-60 min)
- Save selection to user preferences
- **Dependencies:** TASK-0.2, TASK-1.7
- **Estimate:** 2 hours

**TASK-9.2** Integrate energy level into recipe recommendations
- Filter recipes by time constraint
- Adjust recommendation weights
- **Dependencies:** TASK-9.1, TASK-5.1
- **Estimate:** 2 hours

**TASK-9.3** Display energy-appropriate suggestions on dashboard
- Create dashboard widget showing recipes matching current energy level
- Quick-access cards
- **Dependencies:** TASK-9.2
- **Estimate:** 2 hours

### 3.11 Phase 10: Takeout Fallback Map

**TASK-10.1** Detect "Exhausted" energy level trigger
- When energy level is set to "Exhausted", automatically switch to map view
- Display "Let's find you something nearby" message
- **Dependencies:** TASK-9.1
- **Estimate:** 1 hour

**TASK-10.2** Implement venue search using Google Places API
- Create `/api/venues/nearby` endpoint
- Use user's location (browser geolocation)
- Search for restaurants within 2km
- Filter by price level based on remaining budget
- **Dependencies:** TASK-10.1, TASK-0.5
- **Estimate:** 4 hours

**TASK-10.3** Build map view UI
- Create `/app/takeout/page.tsx`
- Embed Google Maps with user location marker
- Display venue markers
- List view below map with venue cards
- **Dependencies:** TASK-10.2, TASK-0.2
- **Estimate:** 5 hours

**TASK-10.4** Implement venue filtering by budget and nutrition
- Filter venues by price level ($ to $$$$)
- If nutrition goals set, prioritize "healthy" cuisine types
- Sort by distance
- **Dependencies:** TASK-10.3
- **Estimate:** 3 hours

**TASK-10.5** Build venue detail view
- Create `/app/venues/[id]/page.tsx`
- Display: name, address, phone, hours, rating, photos
- Menu link (if available)
- "Get Directions" button (Google Maps deep link)
- **Dependencies:** TASK-10.3
- **Estimate:** 3 hours

**TASK-10.6** Implement manual takeout meal logging
- After visiting venue, prompt to log meal
- Manual nutrition entry (optional)
- Estimate calories, protein, carbs, fat
- Add to meal log and budget
- **Dependencies:** TASK-10.5, TASK-5.6
- **Estimate:** 3 hours

**TASK-10.7** Track takeout spending against budget
- Deduct meal cost from remaining budget
- Display updated budget in UI
- **Dependencies:** TASK-10.6, TASK-2.9
- **Estimate:** 2 hours

### 3.12 Phase 11: Dashboard & User Experience

**TASK-11.1** Build main dashboard
- Create `/app/dashboard/page.tsx`
- Widgets:
  - Upcoming meal plans
  - Today's nutrition progress
  - Expiring inventory items
  - Budget summary
  - Quick actions (import recipe, add to inventory)
- **Dependencies:** All previous phases
- **Estimate:** 6 hours

**TASK-11.2** Implement global search
- Search across recipes, inventory, meal plans
- Command palette (Cmd+K)
- Use Algolia or built-in search
- **Dependencies:** TASK-11.1
- **Estimate:** 4 hours

**TASK-11.3** Build mobile-responsive navigation
- Bottom tab bar for mobile
- Sidebar for desktop
- Burger menu for tablets
- **Dependencies:** TASK-0.2
- **Estimate:** 3 hours

**TASK-11.4** Implement loading skeletons and optimistic UI
- Add skeleton loaders for all async content
- Optimistic updates for mutations
- Toast notifications for success/error
- **Dependencies:** TASK-0.2
- **Estimate:** 4 hours

**TASK-11.5** Build empty states
- Friendly messages when no data exists
- Call-to-action buttons
- Illustrations or icons
- **Dependencies:** TASK-11.1
- **Estimate:** 2 hours

**TASK-11.6** Implement error boundaries
- Catch React errors gracefully
- Display user-friendly error pages
- Log errors to monitoring service
- **Dependencies:** TASK-0.1
- **Estimate:** 2 hours

**TASK-11.7** Add accessibility features
- ARIA labels
- Keyboard navigation
- Screen reader support
- Focus management
- **Dependencies:** TASK-0.2
- **Estimate:** 4 hours

**TASK-11.8** Implement dark mode
- Tailwind dark mode classes
- User preference toggle
- System preference detection
- **Dependencies:** TASK-11.1
- **Estimate:** 3 hours

### 3.13 Phase 12: Testing & Quality Assurance

**TASK-12.1** Write unit tests for utility functions
- Test date/time utilities
- Test nutrition calculations
- Test substitution logic
- Achieve 80%+ coverage
- **Dependencies:** All previous phases
- **Estimate:** 6 hours

**TASK-12.2** Write integration tests for API routes
- Test recipe transcription flow
- Test meal planning flow
- Test inventory management
- Mock external APIs
- **Dependencies:** TASK-12.1
- **Estimate:** 8 hours

**TASK-12.3** Write E2E tests for critical user flows
- Onboarding flow
- Recipe import → meal plan → logging
- Inventory → recipe recommendation
- Use Playwright or Cypress
- **Dependencies:** TASK-12.2
- **Estimate:** 8 hours

**TASK-12.4** Perform manual QA on all features
- Test on Chrome, Safari, Firefox
- Test on iOS and Android
- Document bugs
- **Dependencies:** TASK-12.3
- **Estimate:** 6 hours

**TASK-12.5** Fix critical bugs identified in QA
- Prioritize by severity
- Re-test after fixes
- **Dependencies:** TASK-12.4
- **Estimate:** 8 hours

**TASK-12.6** Conduct performance audit
- Run Lighthouse tests
- Optimize images
- Code-split heavy components
- Achieve 90+ performance score
- **Dependencies:** TASK-12.5
- **Estimate:** 4 hours

**TASK-12.7** Security audit
- Check for XSS vulnerabilities
- Validate API authentication
- Test CSRF protection
- Review environment variable security
- **Dependencies:** TASK-12.6
- **Estimate:** 4 hours

### 3.14 Phase 13: Deployment & DevOps

**TASK-13.1** Set up CI/CD pipeline
- Configure GitHub Actions
- Run linting, type checking, tests on PR
- Auto-deploy to preview on PR
- Auto-deploy to production on merge to main
- **Dependencies:** TASK-12.7
- **Estimate:** 4 hours

**TASK-13.2** Configure production environment variables on Vercel
- Add all API keys
- Set up environment-specific configs
- Configure domains
- **Dependencies:** TASK-13.1
- **Estimate:** 2 hours

**TASK-13.3** Set up error monitoring
- Integrate Sentry or similar
- Configure source maps
- Set up alerts
- **Dependencies:** TASK-13.2
- **Estimate:** 2 hours

**TASK-13.4** Set up analytics
- Integrate Vercel Analytics or Google Analytics
- Track key user actions
- Set up conversion funnels
- **Dependencies:** TASK-13.3
- **Estimate:** 2 hours

**TASK-13.5** Configure CDN and caching
- Optimize image delivery via Sanity CDN
- Set up edge caching for API routes
- Configure stale-while-revalidate
- **Dependencies:** TASK-13.4
- **Estimate:** 2 hours

**TASK-13.6** Deploy to production
- Run final smoke tests
- Deploy to Vercel production
- Monitor for errors
- **Dependencies:** TASK-13.5
- **Estimate:** 2 hours

**TASK-13.7** Set up backup and disaster recovery
- Configure Sanity backup exports
- Document recovery procedures
- **Dependencies:** TASK-13.6
- **Estimate:** 2 hours

### 3.15 Phase 14: Documentation & Handoff

**TASK-14.1** Write developer documentation
- README with setup instructions
- API documentation
- Architecture overview
- Deployment guide
- **Dependencies:** TASK-13.7
- **Estimate:** 4 hours

**TASK-14.2** Write user documentation
- Getting started guide
- Feature tutorials
- FAQ
- **Dependencies:** TASK-14.1
- **Estimate:** 3 hours

**TASK-14.3** Create video demo
- Record walkthrough of key features
- Upload to YouTube
- Embed on landing page
- **Dependencies:** TASK-14.2
- **Estimate:** 3 hours

**TASK-14.4** Prepare for launch
- Write launch announcement
- Share on social media
- Submit to Product Hunt (optional)
- **Dependencies:** TASK-14.3
- **Estimate:** 2 hours

---

## 4. DEPENDENCY GRAPH

```
Phase 0 (Foundation)
  │
  ├─> Phase 1 (Onboarding)
  │
  ├─> Phase 2 (Inventory)
  │
  ├─> Phase 3 (Recipe Transcriber)
  │
  ├─> Phase 4 (Calendar)
  │
  └─> Phase 5 (AI Recommendations)
        │
        ├─> Phase 6 (Meal Planning)
        │     │
        │     ├─> Phase 7 (Notifications)
        │     │
        │     └─> Phase 8 (Substitutions)
        │
        ├─> Phase 9 (Energy Levels)
        │     │
        │     └─> Phase 10 (Takeout Map)
        │
        └─> Phase 11 (Dashboard & UX)
              │
              └─> Phase 12 (Testing)
                    │
                    └─> Phase 13 (Deployment)
                          │
                          └─> Phase 14 (Documentation)
```

---

## 5. EDGE CASES & ERROR HANDLING

### 5.1 Video Transcription Failures

**EDGE-1.1** Video URL is invalid or inaccessible
- **Handling:** Validate URL format before API call; return user-friendly error; suggest manual entry

**EDGE-1.2** Video has no spoken words or on-screen text
- **Handling:** AI returns low confidence score; prompt user to add missing details manually

**EDGE-1.3** Video is in a non-English language
- **Handling:** Use Gemini's multilingual support; allow user to specify language; translate to English

**EDGE-1.4** Video contains copyrighted content that blocks download
- **Handling:** Catch download error; inform user; suggest manual entry

**EDGE-1.5** AI hallucinations produce nonsensical recipe
- **Handling:** Validate recipe structure; flag impossible measurements (e.g., "10 cups of salt"); require user review

### 5.2 Inventory Management

**EDGE-2.1** Receipt is blurry or OCR fails
- **Handling:** Display low confidence warning; allow manual correction; save original image for reference

**EDGE-2.2** User tries to decrement inventory below zero
- **Handling:** Prevent negative quantities; prompt user to remove item or adjust quantity

**EDGE-2.3** Multiple items with similar names
- **Handling:** Use fuzzy matching; show disambiguation dialog; learn from user's choice

**EDGE-2.4** Expiration date is in the past when adding item
- **Handling:** Warn user; allow override; mark as "expired" status

### 5.3 Meal Scheduling

**EDGE-3.1** No free time blocks available on selected date
- **Handling:** Suggest next available date; allow user to override and schedule anyway; warn about conflicts

**EDGE-3.2** Calendar sync fails due to expired OAuth token
- **Handling:** Detect 401 error; prompt user to re-authenticate; preserve local meal plans

**EDGE-3.3** Meal prep time exceeds all available free blocks
- **Handling:** Suggest splitting prep across multiple blocks (e.g., thaw night before); suggest shorter recipes

**EDGE-3.4** User's location/timezone changes
- **Handling:** Detect timezone change; adjust meal plan times; re-sync calendar

### 5.4 Substitutions

**EDGE-4.1** No suitable substitution exists in inventory
- **Handling:** Suggest common substitutes user might have; suggest omitting ingredient; estimate impact on final dish

**EDGE-4.2** Substitution makes recipe inedible (e.g., salt instead of sugar)
- **Handling:** AI uses culinary knowledge to reject unsafe substitutions; warn user of major flavor changes

**EDGE-4.3** Multiple cascading substitutions create an entirely different dish
- **Handling:** Track cumulative changes; warn user after 3+ substitutions; suggest finding different recipe

### 5.5 Takeout Fallback

**EDGE-5.1** User denies location permission
- **Handling:** Request manual address entry; use default location (e.g., campus center); explain benefits of location access

**EDGE-5.2** No venues found within budget
- **Handling:** Expand search radius; suggest increasing budget temporarily; recommend cooking instead

**EDGE-5.3** Venue data is outdated (closed permanently)
- **Handling:** Show Google Maps link for verification; allow user to report closure; update data in background

### 5.6 Nutrition Tracking

**EDGE-6.1** Recipe has no nutrition data available
- **Handling:** Use USDA API to estimate from ingredients; mark as "estimated" with low confidence; allow manual entry

**EDGE-6.2** User logs meal without specifying servings
- **Handling:** Default to recipe's default serving size; allow edit after logging

**EDGE-6.3** User's nutrition goals are nutritionally impossible (e.g., 0g carbs)
- **Handling:** Validate goals against dietary minimums; warn user; suggest consulting professional

---

## 6. MIGRATION STRATEGY FROM CURRENT whatscooking.ai

### 6.1 Preservation Requirements

**CRITICAL: The following features MUST be preserved during migration:**

1. **Apple Calendar Integration**
   - Port `server/calendar-bridge.js` to Next.js API route
   - Preserve `native/CalendarBridge.swift` EventKit bridge
   - Keep loopback-only security model
   - Maintain on-demand Swift compilation
   - Preserve ICS import as fallback

2. **Deterministic Feasibility Engine**
   - Keep `engine.js` hard constraint logic
   - Do NOT replace with AI-based scoring
   - Preserve explicit comparison modes
   - Keep weighted scoring disabled per team config

3. **Real UW Venue Data**
   - Preserve `uwDining.js` with official sources
   - Keep HFS menu links and hours
   - Maintain UW Map building coordinates
   - Keep straight-line distance calculations
   - Do NOT fabricate nutrition/ratings

4. **Nutrition Data Model**
   - Extend existing 6-nutrient model to 20+
   - Keep nullable field design
   - Preserve per-serving/per-100g/per-recipe bases
   - Maintain field-level coverage tracking

5. **State Management**
   - Migrate `state.js` mutation service
   - Preserve undo system for plans and logs
   - Keep independent meal slots design
   - Maintain plan vs. consumption separation

6. **Test Coverage**
   - Port all 35 existing tests to Next.js
   - Maintain 100% pass rate
   - Add new tests for new features

### 6.2 Data Migration Plan

**MIGRATE-1** Export existing localStorage data
- Read `whatscooking.ai.local-demo.v1` key
- Transform AppState schema to Sanity documents
- Preserve user preferences, pantry, meal plans, logs
- Migrate calendar connection state

**MIGRATE-2** Schema evolution
```typescript
// OLD (localStorage)
interface AppState {
  version: 1;
  profile: Profile;
  context: Context;
  pantry: Record<string, number>;
  plan: MealPlan | null;
  mealPlans: MealPlan[];
  logs: Consumption[];
  events: CalendarActivity[];
  calendar: CalendarConnection;
  // ...
}

// NEW (Sanity + extended)
// Keep all old fields, add:
- userId: string (link to auth)
- Nutrient tracking expanded to 20+ fields
- Inventory items with expiration, categories, storage location
- Receipt history
- Video recipe sources
- Taste profile
```

**MIGRATE-3** Backward compatibility
- Support reading v1 localStorage during migration
- Provide one-time export/import tool
- Keep demo data factory for development

### 6.3 Component Migration Map

| Current (Vite) | New (Next.js) | Changes |
|----------------|---------------|---------|
| `App.jsx` | `app/layout.tsx` + `app/dashboard/page.tsx` | Split shell from dashboard |
| `ui/CalendarViews.jsx` | `components/calendar/` | Add Google Calendar |
| `ui/FoodViews.jsx` | `app/discover/page.tsx` | Add video import UI |
| `ui/Core.jsx` | `components/ui/` | Migrate to shadcn/ui |
| `domain/engine.js` | `lib/engine.ts` | Convert to TypeScript, preserve logic |
| `domain/state.js` | `lib/state.ts` + Sanity | Hybrid local + remote state |
| `adapters/storage.js` | `lib/sanity.ts` | Replace localStorage with Sanity |
| `server/calendar-bridge.js` | `app/api/calendar/route.ts` | Next.js API routes |

### 6.4 Feature Parity Checklist

**Phase 0: Infrastructure Setup**
- [ ] Next.js 14+ with App Router
- [ ] TypeScript configuration
- [ ] Sanity CMS project
- [ ] NextAuth.js authentication
- [ ] Environment variables

**Phase 1: Port Existing Features**
- [ ] Apple Calendar bridge working in Next.js
- [ ] ICS import functional
- [ ] Recipe catalog migrated to Sanity
- [ ] Feasibility engine ported (TypeScript)
- [ ] Swipe UI rebuilt with Next.js
- [ ] UW venues displayed correctly
- [ ] Meal planning working
- [ ] Nutrition logging working
- [ ] 35 tests passing

**Phase 2: Add Google Calendar**
- [ ] Google OAuth flow
- [ ] Google Calendar API integration
- [ ] Multi-source calendar merging
- [ ] Deduplication logic

**Phase 3: Enhance Inventory**
- [ ] Fridge scanner (camera + vision AI)
- [ ] Receipt OCR
- [ ] Expiration tracking
- [ ] Budget tracking (weekly/monthly)

**Phase 4: Expand Nutrition**
- [ ] 20+ nutrient options
- [ ] Custom goal setting UI
- [ ] Preset templates
- [ ] Trend charts
- [ ] USDA API integration

**Phase 5: New AI Features**
- [ ] Video recipe transcription
- [ ] Dynamic substitutions
- [ ] Taste profile training
- [ ] Push notifications
- [ ] Takeout fallback

### 6.5 Migration Timeline

```
Week 1-2:   Phase 0 (Infrastructure)
Week 3-4:   Phase 1 (Port existing features)
Week 5:     Phase 2 (Google Calendar)
Week 6-7:   Phase 3 (Enhanced inventory)
Week 8:     Phase 4 (Expanded nutrition)
Week 9-12:  Phase 5 (New AI features)
Week 13-14: Testing, QA, deployment
```

### 6.6 Rollback Plan

- Keep current Vite app running during migration
- Deploy Next.js app to separate domain initially
- Gradual user migration with opt-in
- Maintain localStorage export tool for 90 days
- Document downgrade procedure

---

## 7. PERFORMANCE & SCALABILITY

### 7.1 Performance Targets

| Metric | Target |
|--------|--------|
| First Contentful Paint (FCP) | < 1.5s |
| Largest Contentful Paint (LCP) | < 2.5s |
| Time to Interactive (TTI) | < 3.5s |
| Cumulative Layout Shift (CLS) | < 0.1 |
| First Input Delay (FID) | < 100ms |
| Lighthouse Score | 90+ |

### 7.2 Optimization Strategies

- **Image Optimization:** Use Next.js Image component; WebP format; lazy loading
- **Code Splitting:** Dynamic imports for heavy components (map, video player)
- **API Caching:** SWR for client-side; stale-while-revalidate for API routes
- **Database Indexing:** Index Sanity queries on userId, date, status
- **CDN:** Leverage Vercel Edge Network; cache static assets
- **Bundle Size:** Keep initial JS bundle < 200KB; use tree-shaking

### 7.3 Scalability Considerations

- **Sanity CMS:** Scales to millions of documents; pay-as-you-grow pricing
- **API Rate Limits:** Implement rate limiting on API routes (10 req/sec per user)
- **Background Jobs:** Use Vercel Cron for scheduled tasks; consider Queue system for heavy tasks
- **Video Processing:** Offload to separate worker service if volume increases
- **Notification Delivery:** Batch notifications; use push notification service queue

---

## 8. FUTURE ENHANCEMENTS (Post-MVP)

### 8.1 V2 Features

- **Social Features:** Share recipes with friends; collaborative meal planning
- **Grocery Delivery Integration:** Direct order from inventory shortfalls
- **Smart Shopping Lists:** Auto-generate based on meal plans
- **Meal Prep Mode:** Batch cooking for multiple days
- **Leftovers Tracking:** Log and suggest uses for leftovers
- **Community Recipe Library:** Browse recipes from other users
- **Dietary Coaching:** AI nutritionist chat
- **Smart Kitchen Appliance Integration:** IoT oven/fridge connectivity

### 8.2 Advanced AI Features

- **Voice Cooking Assistant:** Hands-free recipe navigation
- **Image Recognition:** Take photo of ingredients; auto-add to inventory
- **Predictive Shopping:** ML model predicts when you'll run out
- **Flavor Profile Learning:** Deep learning on taste preferences
- **Meal Plan Optimization:** Genetic algorithm for weekly meal plans

---

## 9. SUCCESS METRICS

### 9.1 User Engagement

- **Daily Active Users (DAU):** Track logins per day
- **Recipe Import Rate:** Videos imported per user per week
- **Meal Plan Completion Rate:** % of planned meals actually cooked/eaten
- **Retention:** % of users active after 7, 30, 90 days

### 9.2 Feature Adoption

- **Inventory Management:** % of users adding >= 5 items
- **Calendar Connection:** % of users connecting calendar
- **Notification Opt-In:** % of users enabling push notifications
- **Takeout Fallback Usage:** Frequency of map view usage

### 9.3 Business Metrics

- **Budget Adherence:** % of users staying within budget
- **Food Waste Reduction:** Inferred from inventory expiration rates
- **Time Saved:** Average cooking time vs. expected time
- **User Satisfaction:** NPS score

---

## APPENDIX A: GLOSSARY

- **EARS:** Easy Approach to Requirements Syntax
- **PWA:** Progressive Web App
- **CMS:** Content Management System
- **OCR:** Optical Character Recognition
- **USDA:** United States Department of Agriculture
- **VAPID:** Voluntary Application Server Identification
- **SWR:** Stale-While-Revalidate (data fetching strategy)
- **NPS:** Net Promoter Score

---

## APPENDIX B: REFERENCES

- [Next.js Documentation](https://nextjs.org/docs)
- [Sanity.io Documentation](https://www.sanity.io/docs)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [Google Gemini API](https://ai.google.dev/docs)
- [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide.html)
- [Google Maps Platform](https://developers.google.com/maps/documentation)
- [Web Push Protocol](https://developers.google.com/web/fundamentals/push-notifications)

---

**END OF SPECIFICATION**

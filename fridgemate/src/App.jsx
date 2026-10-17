
import { useState } from "react";
import "./App.css";

const meals = [
  {
    name: "Creamy Garlic Fried Rice",
    time: "15 min",
    match: 92,
    difficulty: "Easy",
    ingredients: ["Rice", "Eggs", "Garlic", "Soy sauce"],
    description: "A quick, comforting meal for busy days.",
    color: "#f4d8a8",
    emoji: "🍚",
  },
  {
    name: "Crispy Chickpea Bowl",
    time: "20 min",
    match: 80,
    difficulty: "Easy",
    ingredients: ["Chickpeas", "Yogurt", "Cucumber", "Rice"],
    description: "Protein-packed, fresh, and filling.",
    color: "#dce8c7",
    emoji: "🥗",
  },
  {
    name: "Cheesy Tomato Pasta",
    time: "18 min",
    match: 75,
    difficulty: "Easy",
    ingredients: ["Pasta", "Tomatoes", "Cheese", "Garlic"],
    description: "A cozy dinner with ingredients you probably have.",
    color: "#f2c9bb",
    emoji: "🍝",
  },
];

function App() {
  const [fridge, setFridge] = useState("Rice, eggs, garlic, pasta, tomatoes");
  const [maxTime, setMaxTime] = useState("20");
  const [diet, setDiet] = useState("Anything");
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState([]);
  const [showSaved, setShowSaved] = useState(false);

  const currentMeal = meals[index % meals.length];

  function nextMeal() {
    setIndex((previous) => previous + 1);
  }

  function saveMeal() {
    setSaved((previous) =>
      previous.some((meal) => meal.name === currentMeal.name)
        ? previous
        : [...previous, currentMeal]
    );
    nextMeal();
  }

  return (
    <main className="app-shell">
      <nav className="navbar">
        <a className="brand" href="#">
          <span className="brand-icon">🥑</span> fridge<span>mate</span>
        </a>
        <button className="saved-button" onClick={() => setShowSaved(!showSaved)}>
          ♡ Saved meals ({saved.length})
        </button>
      </nav>

      <section className="hero">
        <div className="eyebrow">
          <span className="status-dot" /> YOUR PERSONAL FOOD AGENT
        </div>
        <h1>
          Your fridge has
          <br />
          <span>more potential.</span>
        </h1>
        <p className="hero-description">
          Less deciding. Less wasting. More eating well.
          <br />
          Let's figure out what's for dinner.
        </p>
      </section>

      <section className="workspace">
        <aside className="preferences panel">
          <div className="section-label">01 / YOUR KITCHEN</div>
          <h2>What's in your fridge?</h2>
          <p className="muted">
            Tell us what you have. We'll find something worth making.
          </p>

          <label htmlFor="ingredients">Ingredients on hand</label>
          <textarea
            id="ingredients"
            value={fridge}
            onChange={(event) => setFridge(event.target.value)}
            placeholder="e.g. eggs, spinach, leftover rice..."
            rows={5}
          />

          <label htmlFor="time">Time available</label>
          <div className="time-options">
            {["10", "20", "30", "45"].map((time) => (
              <button
                key={time}
                className={`time-option ${maxTime === time ? "selected" : ""}`}
                onClick={() => setMaxTime(time)}
              >
                {time}m
              </button>
            ))}
          </div>

          <label htmlFor="diet">Food preference</label>
          <select
            id="diet"
            value={diet}
            onChange={(event) => setDiet(event.target.value)}
          >
            <option>Anything</option>
            <option>Vegetarian</option>
            <option>Vegan</option>
            <option>High protein</option>
          </select>

          <button
            className="primary-button"
            onClick={() => {
              setIndex(0);
              setShowSaved(false);
            }}
          >
            Find my next meal <span>↗</span>
          </button>
          <p className="tiny-note">
            ✳ Your ingredients, your schedule, your call.
          </p>
        </aside>

        <section className="discover">
          <div className="discover-heading">
            <div>
              <div className="section-label">02 / THE DISCOVERY</div>
              <h2>{showSaved ? "Your saved meals" : "Tonight could look like..."}</h2>
            </div>
            {!showSaved && <span className="counter">0{(index % 3) + 1} / 03</span>}
          </div>

          {showSaved ? (
            <div className="saved-list">
              {saved.length === 0 ? (
                <p className="muted">No meals saved yet. Find a meal you love and tap ♡.</p>
              ) : (
                saved.map((meal) => (
                  <div className="saved-item" key={meal.name}>
                    <span className="saved-emoji">{meal.emoji}</span>
                    <div>
                      <strong>{meal.name}</strong>
                      <p className="muted">{meal.time} · {meal.match}% ingredient match</p>
                    </div>
                  </div>
                ))
              )}
              <button className="secondary-button" onClick={() => setShowSaved(false)}>
                Back to discovery
              </button>
            </div>
          ) : (
            <>
              <article className="meal-card">
                <div className="meal-art" style={{ background: currentMeal.color }}>
                  <span className="meal-emoji">{currentMeal.emoji}</span>
                  <span className="match-badge">✳ {currentMeal.match}% ingredient match</span>
                  <span className="art-decoration decoration-one">✳</span>
                  <span className="art-decoration decoration-two">·</span>
                </div>
                <div className="meal-details">
                  <div className="meal-meta">
                    <span>◷ {currentMeal.time}</span>
                    <span>·</span>
                    <span>{currentMeal.difficulty}</span>
                  </div>
                  <h3>{currentMeal.name}</h3>
                  <p className="muted">{currentMeal.description}</p>
                  <div className="ingredient-chips">
                    {currentMeal.ingredients.map((ingredient) => (
                      <span key={ingredient}>{ingredient}</span>
                    ))}
                  </div>
                </div>
              </article>

              <div className="meal-actions">
                <button className="skip-button" onClick={nextMeal}>
                  <span>↻</span> Not this one
                </button>
                <button className="like-button" onClick={saveMeal}>
                  ♡ Save this meal
                </button>
              </div>
              <p className="swipe-hint">Not feeling it? Skip until something clicks.</p>
            </>
          )}
        </section>
      </section>

      <footer>
        <span>fridgemate © 2026</span>
        <span>Made for hungry students, not perfect kitchens.</span>
      </footer>
    </main>
  );
}

export default App;

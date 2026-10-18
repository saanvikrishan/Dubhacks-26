import uwSource from "./uw/browser.json" with {type:"json"};
export const UW_MAP_SOURCE =
  "https://www.washington.edu/maps/?json=campusmap.get_locations";
export const DEAL_SOURCE = "https://hfs.washington.edu/eat/husky-deals/";
export const HUB = { name: "UW HUB", lat: 47.655318, lng: -122.30519045767 };
const weekdays = [
  null,
  [450, 1320],
  [450, 1320],
  [450, 1320],
  [450, 1320],
  [450, 1320],
  null,
];
// Public UW building pins; straight-line distances are derived, not walking routes.
export const uwDining = [
  {
    id: "local-point",
    name: "Local Point",
    location: "Lander Hall · West Campus",
    lat: 47.655665634132,
    lng: -122.31506904899,
    code: "lah",
    description:
      "Pizza, deli sandwiches, burgers, rotating entrées, and a salad bar.",
    menu: "https://hfs.uw.edu/eat/locations-and-hours/local-point/",
    weeklyMenu:
      "https://hfs.uw.edu/media/4u5nqbum/week-3-autumn-menus-local-point-oct-12-oct-18-compressed.pdf",
    hours: [[480, 1320], ...weekdays.slice(1, 6), [480, 1320]],
    offers: [
      { name: "Toasted cheese + 8 oz soup", price: 5.99 },
      { name: "Build-your-own pasta", price: 8.49 },
      { name: "Cheese pizza slice", price: 3.49 },
    ],
    photo: "pasta",
    rating: null,
    checkedAt: "2026-10-17",
  },
  {
    id: "center-table",
    name: "Center Table",
    location: "Oliver Hall · North Campus",
    lat: 47.660001521503,
    lng: -122.30423292456,
    code: "wlw",
    description:
      "Nine stations, including pasta, deli, pizza, and Select for specific dietary needs.",
    menu: "https://hfs.uw.edu/eat/locations-and-hours/center-table/",
    weeklyMenu:
      "https://hfs.uw.edu/media/d25li5l5/week-3-autumn-menus-center-table-oct-12-18-compressed.pdf",
    hours: [[480, 1320], ...weekdays.slice(1, 6), [480, 1320]],
    offers: [
      { name: "Build-your-own pasta", price: 8.49 },
      { name: "Toasted cheese + 8 oz soup", price: 5.99 },
      { name: "Cheese pizza slice", price: 3.49 },
    ],
    photo: "pasta",
    rating: null,
    checkedAt: "2026-10-17",
  },
  {
    id: "husky-den",
    name: "Husky Den Food Court",
    location: "Husky Union Building · On site",
    lat: HUB.lat,
    lng: HUB.lng,
    code: "hub",
    description:
      "Cantina, Firecracker, Katora, Dawg House Pizza, Red Radish, and more.",
    menu: "https://hfs.uw.edu/eat/locations-and-hours/husky-den/",
    hours: [
      null,
      [615, 1140],
      [615, 1140],
      [615, 1140],
      [615, 1140],
      [615, 900],
      null,
    ],
    offers: [
      { name: "Red Radish toasted cheese + soup", price: 5.99 },
      { name: "Firecracker one-item combo", price: 10.49 },
      { name: "Cheese pizza slice", price: 3.49 },
    ],
    photo: "tofu",
    rating: null,
    checkedAt: "2026-10-17",
  },
  {
    id: "by-george",
    name: "By George",
    location: "Odegaard Undergraduate Library · Central Campus",
    lat: 47.65646093404,
    lng: -122.3104401865,
    code: "oug",
    description:
      "Hot sandwiches, soups, açaí bowls, coffee, and grab-and-go food.",
    menu: "https://hfs.uw.edu/eat/locations-and-hours/by-george/",
    hours: [
      null,
      [450, 1200],
      [450, 1200],
      [450, 1200],
      [450, 1200],
      [450, 1020],
      null,
    ],
    offers: [
      { name: "Toasted cheese + 8 oz soup", price: 5.99 },
      { name: "Breakfast sandwich + drip coffee", price: 8.49 },
    ],
    photo: "chickpeas",
    rating: null,
    checkedAt: "2026-10-17",
  },
  {
    id: "cultivate",
    name: "Cultivate",
    location: "Elm Hall · West Campus",
    lat: 47.656524351302,
    lng: -122.31496712967,
    code: "elm-hall",
    description:
      "Seasonal restaurant-style meals. Check the current menu for prices and dishes.",
    menu: "https://hfs.uw.edu/eat/locations-and-hours/cultivate/",
    hours: [
      null,
      [690, 1230],
      [690, 1230],
      [690, 1230],
      [690, 1230],
      [690, 900],
      null,
    ],
    offers: [],
    photo: "tofu",
    rating: null,
    checkedAt: "2026-10-17",
  },
];
export function distanceMeters(venue, origin = HUB) {
  const rad = (n) => (n * Math.PI) / 180,
    dl = rad(venue.lat - origin.lat),
    dn = rad(venue.lng - origin.lng);
  const a =
    Math.sin(dl / 2) ** 2 +
    Math.cos(rad(origin.lat)) *
      Math.cos(rad(venue.lat)) *
      Math.sin(dn / 2) ** 2;
  return (
    Math.round(
      (6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 50,
    ) * 50
  );
}
export const directionsUrl = (venue) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent("Husky Union Building, University of Washington, Seattle")}&destination=${encodeURIComponent(venue.name + ", University of Washington, Seattle")}&travelmode=walking`;
export const ratingUrl = (venue) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ", University of Washington, Seattle")}`;
export function venueHours(venue, date, time) {
  if (["local-point","center-table","husky-den"].includes(venue.id)) {
    const h = uwSource.reviewed.hours.find(h=>h.venueId===venue.id && uwSource.snapshot.venues.some(v=>v.id===h.venueId && v.hoursSha256===h.hoursSha256));
    if (!h || date<h.validFrom || date>h.validTo) return {range:null,open:false,status:"unknown"};
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const minute = Number(time.slice(0,2))*60+Number(time.slice(3));
    const range = h.general[day]?.[0]??null;
    const knownStationOpen = h.stationHours.some(s=>s.week[day]?.some(([open,close])=>minute>=open&&minute<close));
    return {range,open:(!!range&&minute>=range[0]&&minute<range[1]) || knownStationOpen,status:range?"published":"closed"};
  }
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(),
    range = venue.hours[day];
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return { range, open: !!range && minute >= range[0] && minute < range[1] };
}

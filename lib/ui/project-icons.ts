import {
  IoFolder, IoBriefcase, IoSchool, IoBook, IoLibrary, IoDocumentText, IoNewspaper, IoReceipt,
  IoBarbell, IoFitness, IoBody, IoHeart, IoMedkit, IoNutrition, IoRestaurant, IoCafe, IoBed,
  IoLeaf, IoPaw, IoWater, IoSunny, IoMoon, IoCloud,
  IoHome, IoStorefront, IoBusiness, IoCart, IoCash, IoCard, IoWallet, IoPricetag,
  IoAirplane, IoCar, IoBoat, IoBicycle, IoMap, IoCompass, IoEarth, IoGlobe,
  IoCamera, IoFilm, IoMusicalNotes, IoHeadset, IoMic, IoBrush, IoColorPalette,
  IoCode, IoTerminal, IoHardwareChip, IoServer, IoLaptop, IoDesktop, IoPhonePortrait, IoWatch,
  IoBulb, IoRocket, IoFlame, IoSparkles, IoStar, IoTrophy, IoFlag, IoRibbon,
  IoCalendar, IoAlarm, IoTime, IoChatbubbles, IoMail, IoPeople, IoPerson,
  IoGameController, IoFootball, IoBasketball, IoTennisball, IoGift, IoBalloon, IoDiamond,
  IoTelescope, IoFlask, IoMagnet, IoConstruct, IoHammer, IoBuild, IoSettings,
  IoShieldCheckmark, IoLockClosed, IoKey, IoTrendingUp, IoStatsChart, IoPieChart,
} from "react-icons/io5";
import type { IconType } from "react-icons";

/**
 * The icons a project can wear. Filled Ionicons only, so a project glyph sits
 * in the same solid family as the nav and never reads as a lighter weight
 * beside them. Stored on the project as the plain name, resolved on render.
 *
 * `keywords` only widens the search: a name already matches on itself.
 */
export interface ProjectIcon {
  name: string;
  label: string;
  Icon: IconType;
  keywords?: string;
}

export const PROJECT_ICONS: ProjectIcon[] = [
  { name: "IoFolder", label: "Folder", Icon: IoFolder, keywords: "default file" },
  { name: "IoBriefcase", label: "Briefcase", Icon: IoBriefcase, keywords: "work job career" },
  { name: "IoSchool", label: "School", Icon: IoSchool, keywords: "study university degree exam" },
  { name: "IoBook", label: "Book", Icon: IoBook, keywords: "reading study notes" },
  { name: "IoLibrary", label: "Library", Icon: IoLibrary, keywords: "reading research archive" },
  { name: "IoDocumentText", label: "Document", Icon: IoDocumentText, keywords: "writing paper notes" },
  { name: "IoNewspaper", label: "Newspaper", Icon: IoNewspaper, keywords: "blog news writing" },
  { name: "IoReceipt", label: "Receipt", Icon: IoReceipt, keywords: "invoice expenses tax" },

  { name: "IoBarbell", label: "Barbell", Icon: IoBarbell, keywords: "gym lifting strength workout" },
  { name: "IoFitness", label: "Fitness", Icon: IoFitness, keywords: "health cardio pulse" },
  { name: "IoBody", label: "Body", Icon: IoBody, keywords: "health posture physio" },
  { name: "IoHeart", label: "Heart", Icon: IoHeart, keywords: "health love relationship" },
  { name: "IoMedkit", label: "Medkit", Icon: IoMedkit, keywords: "health doctor medical" },
  { name: "IoNutrition", label: "Nutrition", Icon: IoNutrition, keywords: "food diet eating" },
  { name: "IoRestaurant", label: "Restaurant", Icon: IoRestaurant, keywords: "food cooking meals" },
  { name: "IoCafe", label: "Cafe", Icon: IoCafe, keywords: "coffee break social" },
  { name: "IoBed", label: "Bed", Icon: IoBed, keywords: "sleep rest routine" },

  { name: "IoLeaf", label: "Leaf", Icon: IoLeaf, keywords: "plants garden nature growth" },
  { name: "IoPaw", label: "Paw", Icon: IoPaw, keywords: "pet dog cat animal" },
  { name: "IoWater", label: "Water", Icon: IoWater, keywords: "hydration drink swim" },
  { name: "IoSunny", label: "Sun", Icon: IoSunny, keywords: "morning routine weather" },
  { name: "IoMoon", label: "Moon", Icon: IoMoon, keywords: "evening night sleep" },
  { name: "IoCloud", label: "Cloud", Icon: IoCloud, keywords: "weather backup hosting" },

  { name: "IoHome", label: "Home", Icon: IoHome, keywords: "house chores flat living" },
  { name: "IoStorefront", label: "Storefront", Icon: IoStorefront, keywords: "shop business retail" },
  { name: "IoBusiness", label: "Business", Icon: IoBusiness, keywords: "company office corporate" },
  { name: "IoCart", label: "Cart", Icon: IoCart, keywords: "shopping groceries buy" },
  { name: "IoCash", label: "Cash", Icon: IoCash, keywords: "money budget finance" },
  { name: "IoCard", label: "Card", Icon: IoCard, keywords: "payment bank money" },
  { name: "IoWallet", label: "Wallet", Icon: IoWallet, keywords: "money savings budget" },
  { name: "IoPricetag", label: "Price tag", Icon: IoPricetag, keywords: "label sale deal" },

  { name: "IoAirplane", label: "Aeroplane", Icon: IoAirplane, keywords: "travel flight holiday trip" },
  { name: "IoCar", label: "Car", Icon: IoCar, keywords: "driving commute vehicle" },
  { name: "IoBoat", label: "Boat", Icon: IoBoat, keywords: "sailing travel water" },
  { name: "IoBicycle", label: "Bicycle", Icon: IoBicycle, keywords: "cycling commute sport" },
  { name: "IoMap", label: "Map", Icon: IoMap, keywords: "travel plan route" },
  { name: "IoCompass", label: "Compass", Icon: IoCompass, keywords: "direction explore navigate" },
  { name: "IoEarth", label: "Earth", Icon: IoEarth, keywords: "world global travel" },
  { name: "IoGlobe", label: "Globe", Icon: IoGlobe, keywords: "world web international" },

  { name: "IoCamera", label: "Camera", Icon: IoCamera, keywords: "photography photos shoot" },
  { name: "IoFilm", label: "Film", Icon: IoFilm, keywords: "video movies editing" },
  { name: "IoMusicalNotes", label: "Music", Icon: IoMusicalNotes, keywords: "practice instrument song" },
  { name: "IoHeadset", label: "Headset", Icon: IoHeadset, keywords: "podcast listening audio" },
  { name: "IoMic", label: "Microphone", Icon: IoMic, keywords: "podcast recording speaking" },
  { name: "IoBrush", label: "Brush", Icon: IoBrush, keywords: "art painting design" },
  { name: "IoColorPalette", label: "Palette", Icon: IoColorPalette, keywords: "design colour art" },

  { name: "IoCode", label: "Code", Icon: IoCode, keywords: "programming dev software" },
  { name: "IoTerminal", label: "Terminal", Icon: IoTerminal, keywords: "shell dev cli" },
  { name: "IoHardwareChip", label: "Chip", Icon: IoHardwareChip, keywords: "hardware ai electronics" },
  { name: "IoServer", label: "Server", Icon: IoServer, keywords: "backend infra hosting" },
  { name: "IoLaptop", label: "Laptop", Icon: IoLaptop, keywords: "computer work dev" },
  { name: "IoDesktop", label: "Desktop", Icon: IoDesktop, keywords: "computer setup work" },
  { name: "IoPhonePortrait", label: "Phone", Icon: IoPhonePortrait, keywords: "mobile app ios" },
  { name: "IoWatch", label: "Watch", Icon: IoWatch, keywords: "wearable time fitness" },

  { name: "IoBulb", label: "Bulb", Icon: IoBulb, keywords: "idea learning insight" },
  { name: "IoRocket", label: "Rocket", Icon: IoRocket, keywords: "launch startup ship" },
  { name: "IoFlame", label: "Flame", Icon: IoFlame, keywords: "streak urgent energy" },
  { name: "IoSparkles", label: "Sparkles", Icon: IoSparkles, keywords: "ai magic new" },
  { name: "IoStar", label: "Star", Icon: IoStar, keywords: "favourite important goal" },
  { name: "IoTrophy", label: "Trophy", Icon: IoTrophy, keywords: "win goal achievement" },
  { name: "IoFlag", label: "Flag", Icon: IoFlag, keywords: "milestone goal target" },
  { name: "IoRibbon", label: "Ribbon", Icon: IoRibbon, keywords: "award prize achievement" },

  { name: "IoCalendar", label: "Calendar", Icon: IoCalendar, keywords: "schedule planning dates" },
  { name: "IoAlarm", label: "Alarm", Icon: IoAlarm, keywords: "reminder routine morning" },
  { name: "IoTime", label: "Clock", Icon: IoTime, keywords: "time tracking hours" },
  { name: "IoChatbubbles", label: "Chat", Icon: IoChatbubbles, keywords: "messages talk social" },
  { name: "IoMail", label: "Mail", Icon: IoMail, keywords: "email inbox correspondence" },
  { name: "IoPeople", label: "People", Icon: IoPeople, keywords: "team family friends social" },
  { name: "IoPerson", label: "Person", Icon: IoPerson, keywords: "personal self me" },

  { name: "IoGameController", label: "Controller", Icon: IoGameController, keywords: "gaming play hobby" },
  { name: "IoFootball", label: "Football", Icon: IoFootball, keywords: "sport soccer play" },
  { name: "IoBasketball", label: "Basketball", Icon: IoBasketball, keywords: "sport play team" },
  { name: "IoTennisball", label: "Tennis", Icon: IoTennisball, keywords: "sport play racket" },
  { name: "IoGift", label: "Gift", Icon: IoGift, keywords: "present birthday celebration" },
  { name: "IoBalloon", label: "Balloon", Icon: IoBalloon, keywords: "party celebration event" },
  { name: "IoDiamond", label: "Diamond", Icon: IoDiamond, keywords: "premium valuable quality" },

  { name: "IoTelescope", label: "Telescope", Icon: IoTelescope, keywords: "research explore vision" },
  { name: "IoFlask", label: "Flask", Icon: IoFlask, keywords: "experiment science research" },
  { name: "IoMagnet", label: "Magnet", Icon: IoMagnet, keywords: "attract marketing growth" },
  { name: "IoConstruct", label: "Spanner", Icon: IoConstruct, keywords: "maintenance repair tools" },
  { name: "IoHammer", label: "Hammer", Icon: IoHammer, keywords: "build diy repair" },
  { name: "IoBuild", label: "Tools", Icon: IoBuild, keywords: "maintenance fix setup" },
  { name: "IoSettings", label: "Settings", Icon: IoSettings, keywords: "admin config system" },

  { name: "IoShieldCheckmark", label: "Shield", Icon: IoShieldCheckmark, keywords: "security safety insurance" },
  { name: "IoLockClosed", label: "Lock", Icon: IoLockClosed, keywords: "security private passwords" },
  { name: "IoKey", label: "Key", Icon: IoKey, keywords: "access credentials security" },
  { name: "IoTrendingUp", label: "Trending", Icon: IoTrendingUp, keywords: "growth progress metrics" },
  { name: "IoStatsChart", label: "Stats", Icon: IoStatsChart, keywords: "analytics metrics data" },
  { name: "IoPieChart", label: "Pie chart", Icon: IoPieChart, keywords: "analytics report data" },
];

const BY_NAME = new Map(PROJECT_ICONS.map((i) => [i.name, i]));

export const DEFAULT_PROJECT_ICON = "IoFolder";

/** Resolve a stored name. Unknown or absent falls back to the folder. */
export function projectIcon(name: string | undefined | null): ProjectIcon {
  return (name ? BY_NAME.get(name) : undefined) ?? BY_NAME.get(DEFAULT_PROJECT_ICON)!;
}

/** Name, label and keywords all match, so "gym" finds the barbell. */
export function searchProjectIcons(query: string): ProjectIcon[] {
  const q = query.trim().toLowerCase();
  if (!q) return PROJECT_ICONS;
  return PROJECT_ICONS.filter(
    (i) =>
      i.label.toLowerCase().includes(q) ||
      i.name.toLowerCase().includes(q) ||
      (i.keywords?.includes(q) ?? false),
  );
}

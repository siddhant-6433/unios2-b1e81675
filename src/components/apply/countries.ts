/** Comprehensive list of countries with flag, ISD code, nationality, and phone digits */
export interface CountryInfo {
  code: string;       // ISD code e.g. "+91"
  flag: string;       // emoji flag
  name: string;       // country name
  nationality: string; // nationality adjective
  digits: number;     // typical phone digit count
}

export const COUNTRIES: CountryInfo[] = [
  // ─── South Asia (prioritized for Indian default) ───
  { code: "+91", flag: "🇮🇳", name: "India", nationality: "Indian", digits: 10 },
  { code: "+977", flag: "🇳🇵", name: "Nepal", nationality: "Nepalese", digits: 10 },
  { code: "+880", flag: "🇧🇩", name: "Bangladesh", nationality: "Bangladeshi", digits: 10 },
  { code: "+94", flag: "🇱🇰", name: "Sri Lanka", nationality: "Sri Lankan", digits: 9 },
  { code: "+92", flag: "🇵🇰", name: "Pakistan", nationality: "Pakistani", digits: 10 },
  { code: "+93", flag: "🇦🇫", name: "Afghanistan", nationality: "Afghan", digits: 9 },
  { code: "+975", flag: "🇧🇹", name: "Bhutan", nationality: "Bhutanese", digits: 8 },
  { code: "+960", flag: "🇲🇻", name: "Maldives", nationality: "Maldivian", digits: 7 },

  // ─── Middle East ───
  { code: "+971", flag: "🇦🇪", name: "UAE", nationality: "Emirati", digits: 9 },
  { code: "+966", flag: "🇸🇦", name: "Saudi Arabia", nationality: "Saudi", digits: 9 },
  { code: "+974", flag: "🇶🇦", name: "Qatar", nationality: "Qatari", digits: 8 },
  { code: "+968", flag: "🇴🇲", name: "Oman", nationality: "Omani", digits: 8 },
  { code: "+973", flag: "🇧🇭", name: "Bahrain", nationality: "Bahraini", digits: 8 },
  { code: "+965", flag: "🇰🇼", name: "Kuwait", nationality: "Kuwaiti", digits: 8 },
  { code: "+962", flag: "🇯🇴", name: "Jordan", nationality: "Jordanian", digits: 9 },
  { code: "+964", flag: "🇮🇶", name: "Iraq", nationality: "Iraqi", digits: 10 },
  { code: "+98", flag: "🇮🇷", name: "Iran", nationality: "Iranian", digits: 10 },
  { code: "+972", flag: "🇮🇱", name: "Israel", nationality: "Israeli", digits: 9 },
  { code: "+961", flag: "🇱🇧", name: "Lebanon", nationality: "Lebanese", digits: 8 },
  { code: "+967", flag: "🇾🇪", name: "Yemen", nationality: "Yemeni", digits: 9 },

  // ─── East & Southeast Asia ───
  { code: "+86", flag: "🇨🇳", name: "China", nationality: "Chinese", digits: 11 },
  { code: "+81", flag: "🇯🇵", name: "Japan", nationality: "Japanese", digits: 10 },
  { code: "+82", flag: "🇰🇷", name: "South Korea", nationality: "Korean", digits: 10 },
  { code: "+65", flag: "🇸🇬", name: "Singapore", nationality: "Singaporean", digits: 8 },
  { code: "+60", flag: "🇲🇾", name: "Malaysia", nationality: "Malaysian", digits: 10 },
  { code: "+62", flag: "🇮🇩", name: "Indonesia", nationality: "Indonesian", digits: 11 },
  { code: "+63", flag: "🇵🇭", name: "Philippines", nationality: "Filipino", digits: 10 },
  { code: "+66", flag: "🇹🇭", name: "Thailand", nationality: "Thai", digits: 9 },
  { code: "+84", flag: "🇻🇳", name: "Vietnam", nationality: "Vietnamese", digits: 9 },
  { code: "+95", flag: "🇲🇲", name: "Myanmar", nationality: "Burmese", digits: 9 },
  { code: "+886", flag: "🇹🇼", name: "Taiwan", nationality: "Taiwanese", digits: 9 },
  { code: "+852", flag: "🇭🇰", name: "Hong Kong", nationality: "Hong Konger", digits: 8 },
  { code: "+855", flag: "🇰🇭", name: "Cambodia", nationality: "Cambodian", digits: 9 },
  { code: "+856", flag: "🇱🇦", name: "Laos", nationality: "Laotian", digits: 10 },
  { code: "+976", flag: "🇲🇳", name: "Mongolia", nationality: "Mongolian", digits: 8 },

  // ─── North America ───
  { code: "+1", flag: "🇺🇸", name: "United States", nationality: "American", digits: 10 },
  { code: "+1", flag: "🇨🇦", name: "Canada", nationality: "Canadian", digits: 10 },
  { code: "+52", flag: "🇲🇽", name: "Mexico", nationality: "Mexican", digits: 10 },

  // ─── Europe ───
  { code: "+44", flag: "🇬🇧", name: "United Kingdom", nationality: "British", digits: 10 },
  { code: "+49", flag: "🇩🇪", name: "Germany", nationality: "German", digits: 11 },
  { code: "+33", flag: "🇫🇷", name: "France", nationality: "French", digits: 9 },
  { code: "+39", flag: "🇮🇹", name: "Italy", nationality: "Italian", digits: 10 },
  { code: "+34", flag: "🇪🇸", name: "Spain", nationality: "Spanish", digits: 9 },
  { code: "+31", flag: "🇳🇱", name: "Netherlands", nationality: "Dutch", digits: 9 },
  { code: "+46", flag: "🇸🇪", name: "Sweden", nationality: "Swedish", digits: 9 },
  { code: "+47", flag: "🇳🇴", name: "Norway", nationality: "Norwegian", digits: 8 },
  { code: "+45", flag: "🇩🇰", name: "Denmark", nationality: "Danish", digits: 8 },
  { code: "+358", flag: "🇫🇮", name: "Finland", nationality: "Finnish", digits: 10 },
  { code: "+41", flag: "🇨🇭", name: "Switzerland", nationality: "Swiss", digits: 9 },
  { code: "+43", flag: "🇦🇹", name: "Austria", nationality: "Austrian", digits: 10 },
  { code: "+32", flag: "🇧🇪", name: "Belgium", nationality: "Belgian", digits: 9 },
  { code: "+353", flag: "🇮🇪", name: "Ireland", nationality: "Irish", digits: 9 },
  { code: "+351", flag: "🇵🇹", name: "Portugal", nationality: "Portuguese", digits: 9 },
  { code: "+30", flag: "🇬🇷", name: "Greece", nationality: "Greek", digits: 10 },
  { code: "+48", flag: "🇵🇱", name: "Poland", nationality: "Polish", digits: 9 },
  { code: "+420", flag: "🇨🇿", name: "Czech Republic", nationality: "Czech", digits: 9 },
  { code: "+36", flag: "🇭🇺", name: "Hungary", nationality: "Hungarian", digits: 9 },
  { code: "+40", flag: "🇷🇴", name: "Romania", nationality: "Romanian", digits: 9 },
  { code: "+359", flag: "🇧🇬", name: "Bulgaria", nationality: "Bulgarian", digits: 9 },
  { code: "+385", flag: "🇭🇷", name: "Croatia", nationality: "Croatian", digits: 9 },
  { code: "+381", flag: "🇷🇸", name: "Serbia", nationality: "Serbian", digits: 9 },
  { code: "+380", flag: "🇺🇦", name: "Ukraine", nationality: "Ukrainian", digits: 9 },
  { code: "+7", flag: "🇷🇺", name: "Russia", nationality: "Russian", digits: 10 },
  { code: "+90", flag: "🇹🇷", name: "Turkey", nationality: "Turkish", digits: 10 },
  { code: "+370", flag: "🇱🇹", name: "Lithuania", nationality: "Lithuanian", digits: 8 },
  { code: "+371", flag: "🇱🇻", name: "Latvia", nationality: "Latvian", digits: 8 },
  { code: "+372", flag: "🇪🇪", name: "Estonia", nationality: "Estonian", digits: 8 },
  { code: "+354", flag: "🇮🇸", name: "Iceland", nationality: "Icelandic", digits: 7 },
  { code: "+352", flag: "🇱🇺", name: "Luxembourg", nationality: "Luxembourgish", digits: 9 },
  { code: "+356", flag: "🇲🇹", name: "Malta", nationality: "Maltese", digits: 8 },
  { code: "+357", flag: "🇨🇾", name: "Cyprus", nationality: "Cypriot", digits: 8 },
  { code: "+386", flag: "🇸🇮", name: "Slovenia", nationality: "Slovenian", digits: 8 },
  { code: "+421", flag: "🇸🇰", name: "Slovakia", nationality: "Slovak", digits: 9 },
  { code: "+355", flag: "🇦🇱", name: "Albania", nationality: "Albanian", digits: 9 },
  { code: "+389", flag: "🇲🇰", name: "North Macedonia", nationality: "Macedonian", digits: 8 },
  { code: "+382", flag: "🇲🇪", name: "Montenegro", nationality: "Montenegrin", digits: 8 },
  { code: "+387", flag: "🇧🇦", name: "Bosnia & Herzegovina", nationality: "Bosnian", digits: 8 },
  { code: "+373", flag: "🇲🇩", name: "Moldova", nationality: "Moldovan", digits: 8 },
  { code: "+374", flag: "🇦🇲", name: "Armenia", nationality: "Armenian", digits: 8 },
  { code: "+995", flag: "🇬🇪", name: "Georgia", nationality: "Georgian", digits: 9 },
  { code: "+994", flag: "🇦🇿", name: "Azerbaijan", nationality: "Azerbaijani", digits: 9 },

  // ─── Oceania ───
  { code: "+61", flag: "🇦🇺", name: "Australia", nationality: "Australian", digits: 9 },
  { code: "+64", flag: "🇳🇿", name: "New Zealand", nationality: "New Zealander", digits: 9 },
  { code: "+679", flag: "🇫🇯", name: "Fiji", nationality: "Fijian", digits: 7 },

  // ─── Africa ───
  { code: "+27", flag: "🇿🇦", name: "South Africa", nationality: "South African", digits: 9 },
  { code: "+234", flag: "🇳🇬", name: "Nigeria", nationality: "Nigerian", digits: 10 },
  { code: "+254", flag: "🇰🇪", name: "Kenya", nationality: "Kenyan", digits: 9 },
  { code: "+233", flag: "🇬🇭", name: "Ghana", nationality: "Ghanaian", digits: 9 },
  { code: "+20", flag: "🇪🇬", name: "Egypt", nationality: "Egyptian", digits: 10 },
  { code: "+212", flag: "🇲🇦", name: "Morocco", nationality: "Moroccan", digits: 9 },
  { code: "+216", flag: "🇹🇳", name: "Tunisia", nationality: "Tunisian", digits: 8 },
  { code: "+213", flag: "🇩🇿", name: "Algeria", nationality: "Algerian", digits: 9 },
  { code: "+255", flag: "🇹🇿", name: "Tanzania", nationality: "Tanzanian", digits: 9 },
  { code: "+256", flag: "🇺🇬", name: "Uganda", nationality: "Ugandan", digits: 9 },
  { code: "+251", flag: "🇪🇹", name: "Ethiopia", nationality: "Ethiopian", digits: 9 },
  { code: "+237", flag: "🇨🇲", name: "Cameroon", nationality: "Cameroonian", digits: 9 },
  { code: "+225", flag: "🇨🇮", name: "Côte d'Ivoire", nationality: "Ivorian", digits: 10 },
  { code: "+221", flag: "🇸🇳", name: "Senegal", nationality: "Senegalese", digits: 9 },
  { code: "+263", flag: "🇿🇼", name: "Zimbabwe", nationality: "Zimbabwean", digits: 9 },
  { code: "+260", flag: "🇿🇲", name: "Zambia", nationality: "Zambian", digits: 9 },
  { code: "+258", flag: "🇲🇿", name: "Mozambique", nationality: "Mozambican", digits: 9 },
  { code: "+230", flag: "🇲🇺", name: "Mauritius", nationality: "Mauritian", digits: 8 },
  { code: "+250", flag: "🇷🇼", name: "Rwanda", nationality: "Rwandan", digits: 9 },

  // ─── South & Central America ───
  { code: "+55", flag: "🇧🇷", name: "Brazil", nationality: "Brazilian", digits: 11 },
  { code: "+54", flag: "🇦🇷", name: "Argentina", nationality: "Argentine", digits: 10 },
  { code: "+56", flag: "🇨🇱", name: "Chile", nationality: "Chilean", digits: 9 },
  { code: "+57", flag: "🇨🇴", name: "Colombia", nationality: "Colombian", digits: 10 },
  { code: "+51", flag: "🇵🇪", name: "Peru", nationality: "Peruvian", digits: 9 },
  { code: "+58", flag: "🇻🇪", name: "Venezuela", nationality: "Venezuelan", digits: 10 },
  { code: "+593", flag: "🇪🇨", name: "Ecuador", nationality: "Ecuadorian", digits: 9 },
  { code: "+506", flag: "🇨🇷", name: "Costa Rica", nationality: "Costa Rican", digits: 8 },
  { code: "+507", flag: "🇵🇦", name: "Panama", nationality: "Panamanian", digits: 8 },

  // ─── Central Asia ───
  { code: "+7", flag: "🇰🇿", name: "Kazakhstan", nationality: "Kazakh", digits: 10 },
  { code: "+998", flag: "🇺🇿", name: "Uzbekistan", nationality: "Uzbek", digits: 9 },
  { code: "+996", flag: "🇰🇬", name: "Kyrgyzstan", nationality: "Kyrgyz", digits: 9 },
  { code: "+992", flag: "🇹🇯", name: "Tajikistan", nationality: "Tajik", digits: 9 },
  { code: "+993", flag: "🇹🇲", name: "Turkmenistan", nationality: "Turkmen", digits: 8 },
];

/** Get nationality options for dropdowns (India first) */
export function getNationalityOptions(): { value: string; label: string }[] {
  // Deduplicate by nationality
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const c of COUNTRIES) {
    if (!seen.has(c.nationality)) {
      seen.add(c.nationality);
      options.push({ value: c.nationality, label: `${c.flag} ${c.nationality}` });
    }
  }
  return options;
}

/** Check if a nationality is Indian */
export function isIndianNationality(nationality: string | undefined | null): boolean {
  return !nationality || nationality === 'Indian';
}

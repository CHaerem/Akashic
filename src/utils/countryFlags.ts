/**
 * Country to flag emoji utilities
 * Uses regional indicator symbols to render flag emojis
 */

// Map of country names to ISO 3166-1 alpha-2 codes
const COUNTRY_CODES: Record<string, string> = {
    // Common trekking destinations
    'Peru': 'PE',
    'Nepal': 'NP',
    'India': 'IN',
    'Pakistan': 'PK',
    'Chile': 'CL',
    'Argentina': 'AR',
    'Bolivia': 'BO',
    'Ecuador': 'EC',
    'Colombia': 'CO',
    'Tanzania': 'TZ',
    'Kenya': 'KE',
    'Uganda': 'UG',
    'Ethiopia': 'ET',
    'Morocco': 'MA',
    'South Africa': 'ZA',
    'New Zealand': 'NZ',
    'Australia': 'AU',
    'Japan': 'JP',
    'China': 'CN',
    'Bhutan': 'BT',
    'Tibet': 'CN', // Part of China
    'Switzerland': 'CH',
    'France': 'FR',
    'Italy': 'IT',
    'Austria': 'AT',
    'Germany': 'DE',
    'Spain': 'ES',
    'Portugal': 'PT',
    'Norway': 'NO',
    'Sweden': 'SE',
    'Finland': 'FI',
    'Iceland': 'IS',
    'Scotland': 'GB', // Part of UK
    'United Kingdom': 'GB',
    'UK': 'GB',
    'Ireland': 'IE',
    'Canada': 'CA',
    'United States': 'US',
    'USA': 'US',
    'Mexico': 'MX',
    'Costa Rica': 'CR',
    'Panama': 'PA',
    'Guatemala': 'GT',
    'Indonesia': 'ID',
    'Malaysia': 'MY',
    'Thailand': 'TH',
    'Vietnam': 'VN',
    'Philippines': 'PH',
    'Taiwan': 'TW',
    'South Korea': 'KR',
    'Mongolia': 'MN',
    'Kyrgyzstan': 'KG',
    'Tajikistan': 'TJ',
    'Kazakhstan': 'KZ',
    'Georgia': 'GE',
    'Armenia': 'AM',
    'Turkey': 'TR',
    'Greece': 'GR',
    'Croatia': 'HR',
    'Slovenia': 'SI',
    'Romania': 'RO',
    'Bulgaria': 'BG',
    'Poland': 'PL',
    'Czech Republic': 'CZ',
    'Slovakia': 'SK',
    'Russia': 'RU',
};

/**
 * Convert a 2-letter country code to a flag emoji
 * Uses Unicode regional indicator symbols (U+1F1E6 to U+1F1FF)
 */
function codeToFlag(countryCode: string): string {
    const code = countryCode.toUpperCase();
    if (code.length !== 2) return '';

    // Regional indicator A is at U+1F1E6
    const baseOffset = 0x1F1E6 - 'A'.charCodeAt(0);
    const firstChar = String.fromCodePoint(code.charCodeAt(0) + baseOffset);
    const secondChar = String.fromCodePoint(code.charCodeAt(1) + baseOffset);

    return firstChar + secondChar;
}

/**
 * Get flag emoji for a country name
 * Returns empty string if country not found
 */
export function getCountryFlag(countryName: string): string {
    const code = COUNTRY_CODES[countryName];
    if (!code) return '';
    return codeToFlag(code);
}

/**
 * Get flag emoji with fallback
 * Returns a globe emoji if country not found
 */
export function getCountryFlagOrGlobe(countryName: string): string {
    const flag = getCountryFlag(countryName);
    return flag || '🌍';
}

/**
 * @module utils/date
 * Date utility helper functions.
 * Includes helpers to parse, format, and translate UTC timestamps.
 */

/**
 * Formats a UTC date string (e.g. from SQLite) into Moscow Time (MSK, UTC+3)
 * in 24-hour format (DD.MM.YYYY, HH:MM:SS).
 */
export const formatToMoscowTime = (dateStr: string | Date | undefined | null): string => {
  if (!dateStr) return '';
  
  let isoStr = typeof dateStr === 'string' ? dateStr : dateStr.toISOString();
  
  // If it's a naive SQLite UTC timestamp like "YYYY-MM-DD HH:MM:SS"
  if (typeof dateStr === 'string' && !dateStr.includes('T') && !dateStr.includes('Z')) {
    isoStr = dateStr.replace(' ', 'T') + 'Z';
  }
  
  try {
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return String(dateStr);
    
    return date.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return String(dateStr);
  }
};

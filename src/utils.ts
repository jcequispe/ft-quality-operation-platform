/**
 * Server-side utility functions for ft-quality-operation-platform.
 */

/** Get the current user's email address. */
export function getCurrentUserEmail(): string {
  return Session.getActiveUser().getEmail();
}

/** Log a server-side message. */
export function log(message: string): void {
  Logger.log(`[ft-quality-operation-platform] ${message}`);
}

/**
 * Include external HTML/CSS files into templates.
 * This function is used with <?!= include('filename') ?> in HTML files.
 * 
 * @param filename - The name of the file to include (without extension for CSS, with .html for HTML)
 * @returns The file content as a string
 * 
 * @example
 * // In client.html:
 * // <style><?!= include('styles') ?></style>
 */
export function include(filename: string): string {
  // If no extension provided, assume it's a CSS file
  const fileToInclude = filename.includes('.') ? filename : `${filename}.css`;
  
  try {
    return HtmlService.createHtmlOutputFromFile(fileToInclude).getContent();
  } catch (error) {
    Logger.log(`Error including file ${fileToInclude}: ${error}`);
    return `/* Error loading ${fileToInclude} */`;
  }
}

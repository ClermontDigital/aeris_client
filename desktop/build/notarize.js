exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  // Only run on macOS
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip notarization if credentials are not provided
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASS) {
    console.log('Skipping notarization - APPLE_ID or APPLE_ID_PASS not provided');
    return;
  }

  // Try to require the notarize package, skip if not available
  let notarize;
  try {
    const notarizeModule = require('@electron/notarize');
    notarize = notarizeModule.notarize;
  } catch (error) {
    console.log('Skipping notarization - @electron/notarize package not available:', error.message);
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`Notarizing ${appName}...`);

  try {
    return await notarize({
      appBundleId: 'com.aeris.pos',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASS,
      teamId: process.env.APPLE_TEAM_ID,
    });
  } catch (error) {
    console.error('Notarization failed:', error);
    // Don't fail the build if notarization fails
    return;
  }
}; 
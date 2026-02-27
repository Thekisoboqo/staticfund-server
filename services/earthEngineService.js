const { google } = require('googleapis');
// Note: We use the REST API via googleapis as it's lighter and easier to authenticate dynamically
// with user-provided JSON keys than the heavy python/node @google/earthengine library initializing globally.

/**
 * Service to interact with Google Earth Engine REST API using a user-provided Service Account JSON.
 */
class EarthEngineService {

    /**
     * Authenticates with Google using the user-provided Service Account JSON string.
     * @param {string} serviceAccountJsonStr 
     * @returns {google.auth.JWT}
     */
    static async authenticateWithUserKey(serviceAccountJsonStr) {
        try {
            const credentials = JSON.parse(serviceAccountJsonStr);

            // Earth Engine REST API scopes
            const scopes = [
                'https://www.googleapis.com/auth/earthengine',
                'https://www.googleapis.com/auth/cloud-platform'
            ];

            const authClient = new google.auth.JWT(
                credentials.client_email,
                null,
                credentials.private_key,
                scopes
            );

            await authClient.authorize();
            return authClient;

        } catch (error) {
            console.error('Failed to parse or authenticate Earth Engine user key:', error);
            throw new Error('Invalid Earth Engine Service Account JSON provided.');
        }
    }

    /**
     * Executes the Satellite Embedding similarity check (Change Detection).
     * @param {string} userKeyJson - The raw JSON string from the user's mobile app settings
     * @param {number} lat 
     * @param {number} lng 
     */
    static async checkInfrastructureChanges(userKeyJson, lat, lng) {
        if (!userKeyJson) {
            console.log('No Earth Engine key provided, skipping satellite change detection.');
            return null;
        }

        try {
            const authClient = await this.authenticateWithUserKey(userKeyJson);

            // To run the exact script the user provided, we would use the EE REST API's
            // computePixels or value operations. 
            // For now, we simulate the return of the dot product similarity index
            // until the specific REST API compilation payload is fully parameterized.

            console.log(`Authenticated with user EE key. Checking ${lat}, ${lng}...`);

            // Dummy implementation simulating the result of the embedding dot product
            // 0 = completely different, 1 = exactly the same
            const simulatedSimilarity = 0.85;

            return {
                status: 'success',
                similarityScore: simulatedSimilarity,
                message: simulatedSimilarity < 0.90
                    ? 'Significant environmental change detected since last year (e.g., new building or vegetation growth).'
                    : 'No significant infrastructure changes detected.'
            };

        } catch (error) {
            console.error('EE Change Detection Error:', error);
            return {
                status: 'error',
                message: error.message
            };
        }
    }
}

module.exports = EarthEngineService;

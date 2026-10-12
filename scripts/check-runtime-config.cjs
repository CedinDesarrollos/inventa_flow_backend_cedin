require('dotenv/config');
const { runtimeConfigErrors } = require('../dist/config/validation');
const errors = runtimeConfigErrors(process.env);
if (errors.length) {
    console.error(`Invalid runtime configuration: ${errors.join('; ')}`);
    process.exit(1);
}
console.log('Runtime configuration presence and URL formats verified; connectivity and secret strength require separate checks.');

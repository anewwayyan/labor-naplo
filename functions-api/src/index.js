'use strict';

// Azure Functions v4: importing each module registers its HTTP trigger.
require('./functions/health');
require('./functions/me');
require('./functions/db-check');

const axios = require('axios');
const fs = require('fs'); // Added for logging
const { np, prod, xm } = require('./config');
const env = np;

//PD API KEY 
const apiKey = 'your-pd-api-key'; // Replace with your PagerDuty API key
const baseUrl = 'https://api.pagerduty.com/users';
const limit = 25; // Adjust the limit as needed
let offset = 0;
let allUsers = [];

//Call the function to sync PD Users to xMatters
fetchAllUsers();

async function getPagerDutyUsers() {
    try {
        const response = await axios.get(baseUrl, {
            headers: {
                'Authorization': `Token token=${apiKey}`,
                'Accept': 'application/vnd.pagerduty+json;version=2'
            },
            params: {
                limit: limit,
                offset: offset
            }
        });

        const users = response.data.users;

        if (users.length > 0) {
            console.log(`*********GATHERED ${users.length} PD USERS*********` + JSON.stringify(users));
            allUsers = allUsers.concat(extractUserData(users));
            offset += limit;
            console.log("*********PAGINATING PD USERS API*********");
            return true; // Continue pagination
        } else {
            return false; // End of users
        }
    } catch (error) {
        // Log the error
        fs.appendFileSync('error.log', `Error fetching PagerDuty users: ${error}\n`);
        console.error('Error fetching PagerDuty users:', error);
        throw error;
    }
}

async function listUserContactMethods(apiKey, userId) {
    const baseUrl = `https://api.pagerduty.com/users/${userId}/contact_methods`;

    try {
        const response = await axios.get(baseUrl, {
            headers: {
                'Authorization': `Token token=${apiKey}`,
                'Accept': 'application/vnd.pagerduty+json;version=2'
            }
        });


        return response.data.contact_methods;
    } catch (error) {
        console.error('Error fetching user contact methods:', error);
        throw error;
    }
}

async function getUserLicenseRoleGroup(apiKey, userId) {
    try {
        const response = await axios.get(`https://api.pagerduty.com/users/${userId}/license`, {
            headers: {
                'Authorization': `Token token=${apiKey}`,
                'Accept': 'application/vnd.pagerduty+json;version=2'
            }
        });

        const userData = response.data.license;

        if (userData && userData.role_group) {
            return userData.role_group;
        } else {
            throw new Error(`Role group data for user ${userId} is missing or incomplete.`);
        }
    } catch (error) {
        throw new Error(`Error fetching user data: ${error.message}`);
    }
}


async function fetchAllUsers() {
    try {
        let continuePagination = true;
        while (continuePagination) {
            continuePagination = await getPagerDutyUsers();
        }
        for (var x in allUsers) {
            const contactMethods = await listUserContactMethods(apiKey, allUsers[x].id);
            const pdlicenseType = await getUserLicenseRoleGroup(apiKey, allUsers[x].id);
            allUsers[x].license = pdlicenseType;
            console.log("******RETRIEVED CONTACT METHODS********" + JSON.stringify(contactMethods));
            for (var n in contactMethods) {
                if (contactMethods[n].self.includes(allUsers[x].id) && contactMethods[n].type === "sms_contact_method" && contactMethods[n].label === "Mobile") {
                    allUsers[x].sms = `+${contactMethods[n].country_code}${contactMethods[n].address}`;
                }
                if (contactMethods[n].self.includes(allUsers[x].id) && contactMethods[n].type === "sms_contact_method" && contactMethods[n].label === "Mobile") {
                    allUsers[x].mobilePhone = `+${contactMethods[n].country_code}${contactMethods[n].address}`;
                    // allUsers[x].workPhone = `+${contactMethods[n].country_code}${contactMethods[n].address}`; add work phone?
                }
            }
            var xMpersonCreated = await createxMattersUser(env, allUsers[x]);
            if (!xMpersonCreated) {
                console.log("****NOT CREATED****** " + JSON.stringify(allUsers[x]));
            } else if (xMpersonCreated.status === "ACTIVE") {
                allUsers[x].id = xMpersonCreated.id;
                console.log("****XM PERSON CREATED****** " + JSON.stringify(xMpersonCreated));
                const createUsersDevices = await createDevices(env, allUsers[x]);
            }

        }
        // Write data to JSON file
        fs.writeFileSync('result.json', JSON.stringify(allUsers));
    } catch (error) {
        // Log the error
        fs.appendFileSync('error.log', `Error: ${error}\n`);
        console.error('Error:', error);
    }
}

//Mapping function to get user names and ids from users
function extractUserData(users) {
    return users.map(user => {
        return {
            name: user.name,
            id: user.id,
            email: user.email,
            timeZone: user.time_zone
        };
    });
}

//Transforms PD Data and Creates xMatters Users
async function createxMattersUser(env, pdUser) {

    var xMuser = {};
    var roles = ["Standard User"];
    xMuser.targetName = pdUser.email;
    xMuser.webLogin = pdUser.email;
    xMuser.recipientType = "PERSON";
    xMuser.roles = roles;
    xMuser.status = "ACTIVE";
    xMuser.timezone = pdUser.timeZone;
    xMuser.licenseType = "FULL_USER";
    if (pdUser.license === "FullUser") {
        xMuser.licenseType = "FULL_USER";
    }
    if (pdUser.license === "Stakeholder") {
        xMuser.licenseType = "STAKEHOLDER_USER";
    }
    var nameData = pdUser.name.split(" ");
    if (nameData.length === 2) {
        xMuser.firstName = nameData[0];
        xMuser.lastName = nameData[1];
    } else if (nameData.length === 3) {
        xMuser.firstName = nameData[0];
        xMuser.lastName = `${nameData[1]} ${nameData[2]}`;
    }
    if (xMuser.firstName && xMuser.lastName) {
        var createXmPerson = xm.people.create(env, xMuser);
        return createXmPerson;
    } else return;
}

async function createDevices(env, user) {

    if (user.hasOwnProperty('mobilePhone') && user.mobilePhone.length > 11) {
        let device = {};
        device.owner = user.id;
        device.recipientType = "DEVICE";
        device.deviceType = "VOICE";
        device.name = "Mobile Phone";
        device.phoneNumber = user.mobilePhone;
        let createMobile = xm.devices.create(env, device);
        console.log("********VOICE DEVICE CREATED********* " + JSON.stringify(createMobile));
    }

    if (user.hasOwnProperty('sms') && user.sms.length > 11) {
        let device = {};
        device.owner = user.id;
        device.recipientType = "DEVICE";
        device.deviceType = "TEXT_PHONE";
        device.name = "SMS Phone";
        device.phoneNumber = user.sms;
        let createSMS = xm.devices.create(env, device);
        console.log("********SMS DEVICE CREATED********* " + JSON.stringify(createSMS));
    }

    if (user.hasOwnProperty('email')) {
        let device = {};
        device.owner = user.id;
        device.recipientType = "DEVICE";
        device.deviceType = "EMAIL";
        device.name = "Work Email";
        device.emailAddress = user.email;
        let createEmail = xm.devices.create(env, device);
        console.log("********EMAIL DEVICE CREATED********* " + JSON.stringify(createEmail));
    }


}


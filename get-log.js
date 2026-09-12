const fs = require('fs');
const files = fs.readdirSync('/tmp').filter(f => f.includes('task-252'));
if (files.length > 0) {
  console.log(fs.readFileSync('/tmp/' + files[0], 'utf8'));
} else {
  console.log("No log found");
}

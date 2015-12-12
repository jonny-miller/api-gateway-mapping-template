var PRODUCT_NAME="api-gateway-mapping-template-integration-test";

if (!process.env.AWS_ACCOUNT_ID) {
  throw "process.env.AWS_ACCOUNT_ID is required";
}

process.env.AWS_REGION     = process.env.AWS_REGION     || "ap-northeast-1";
process.env.AWS_PROFILE    = process.env.AWS_PROFILE    || PRODUCT_NAME;
process.env.LAMBDA_ROLE    = process.env.LAMBDA_ROLE    || "arn:aws:iam::" + process.env.AWS_ACCOUNT_ID + ":role/" + PRODUCT_NAME;

var stream = require('stream');
var fs = require('fs');
var crypto = require('crypto');

var sprintf = require("sprintf-js").sprintf;
var Zip = require('adm-zip');
var Promise = require('bluebird');

var Endpoint = require('./endpoint');
var post = require('./post');

(function(examples) {
  var zip = new Zip();
  zip.addFile('index.js', new Buffer("exports.handler = function(event, context) { context.succeed(JSON.stringify(event)); };"));

  var requestTemplates = examples.reduce(function(product, e, i) { product["text/test-" + i] = e.template; return product; }, {});
  var responseModels = examples.reduce(function(product, e, i) { product["text/test-" + i] = "Empty"; return product; }, {});
  var responseTemplates = examples.reduce(function(product, e, i) { product["text/test-" + i] = "$input.path('$')"; return product; }, {});

  var endpoint = new Endpoint({
    region: process.env.AWS_REGION,
    accountId: process.env.AWS_ACCOUNT_ID,
    apiName: PRODUCT_NAME,
    lambdaRole: process.env.LAMBDA_ROLE,
    functionName: PRODUCT_NAME + "-console-log",
    functionZip: zip
  });

  endpoint
    .createFunction()
    .createRestApi()
    .putMethod()
    .putIntegration(requestTemplates)
    .putMethodResponse(responseModels)
    .putIntegrationResponse(responseTemplates)
    .addPermission()
    .deploy()
    .then(function() {
      console.log(endpoint.url);

      var q = examples.map(function(ex, i) {
        return post(endpoint.url, extend({}, ex.headers, {'Content-Type': "text/test-" + i}), ex.payload)
          .then(function(res) {
            res.headers = ex.headers;
            res.template = ex.template;
            res.payload = ex.payload;
            return res;
          });
      });

      return Promise.all(q);
    })
    .then(function(results) {
      var testOut = process.env.TEST ? fs.createWriteStream(process.env.TEST) : process.stdout;
      var markdownOut = process.env.MD ? fs.createWriteStream(process.env.MD) : process.stdout;

      results = results.map(function(result) {
        var r = new Result();
        r.mappingTemplate = result.template;
        r.requestBody = result.payload;
        r.requestHeaders = result.headers;
        r.statusCode = result.statusCode;
        r.responseBody = result.body;
        return r;
      });

      // write markdown
      results.forEach(function(r, i) {
        markdownOut.write(sprintf("## example-%s\n", hash(JSON.stringify(r))));
        r.toMarkdown(markdownOut);
      });

      // write test
      testOut.write(sprintf("// This file is generated by `TEST=%s node misc/gen.js`\n", process.env.TEST));
      testOut.write("\n");
      testOut.write("var assert = require('assert')\n");
      testOut.write("var mappingTemplate = require('../')\n");
      testOut.write("\n");
      testOut.write("describe('$input.path|$input.json', function() {\n");
      var mdUrl = "https://github.com/ToQoz/api-gateway-mapping-template/blob/master/test/_.md";
      results.forEach(function(r, i) {
        testOut.write(sprintf("  // %s#example-%s\n", mdUrl, hash(JSON.stringify(r))));
        r.toTest(testOut, 1);
      });
      testOut.write("});");

      return "";
    })
    .then(function() {
      endpoint.cleanup();
    })
    .catch(function(err) {
      console.error(err);
      err.stack.split('\n').forEach(function(t) { console.error(t); });
      endpoint.cleanup();
    });
})([
  {
    template: '"$input.path(\'$\')"',
    payload: "a=b",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: '"a=b"',
    headers: {},
  },
  {
    template: '"$input.json(\'$\')"',
    payload: "a=b",
    headers: {},
  },
  {
    template: '"$input.json(\'$\')"',
    payload: '"a=b"',
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "{}",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: '"{}"',
    headers: {},
  },
  {
    template: '"$input.json(\'$\')"',
    payload: "{}",
    headers: {},
  },
  {
    template: '{"name": "$input.path(\'$\')"}',
    payload: "name=toqoz",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "{a",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "a{b",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "[a",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "a[",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "null{",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "true{",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "false{",
    headers: {},
  },
  {
    template: '"$input.path(\'$\')"',
    payload: "undefined{",
    headers: {},
  },
  {
    template: '$input',
    payload: "",
    headers: {},
  },
  {
    template: '$util',
    payload: "",
    headers: {},
  },
  {
    template: '$input.params',
    payload: "",
    headers: {},
  },
  {
    template: '$input.json',
    payload: "",
    headers: {},
  },
  {
    template: '$util.urlEncode',
    payload: "",
    headers: {},
  },
]);

function Result() {
  this.mappingTemplate = null;
  this.requestBody = null;
  this.requestHeaders = null;
  this.statusCode = null;
  this.responseBody = null;
}

Result.prototype.toMarkdown = function(out) {
  var s = "";
  var header = Object.keys(this.requestHeaders).map(function(k) { return k + " : " + this.requestHeaders[k]; }.bind(this)).join("\n");

  var h = ["Template", "Header", "Payload", "Status code", "Result"];
  s += h.join("|") + "\n";
  s += h.map(function(v) { return v.replace(/./g, "-"); }).join("|") + "\n";

  s += [
    "`" + this.mappingTemplate + "`",
    "`" + (header || "None") + "`",
    "`" + this.requestBody + "`",
    "`" + this.statusCode + "`",
    "`" + this.responseBody + "`",
  ].join("|");

  out.write(s);
  out.write("\n\n");
};

Result.prototype.toTest = function(out, indentLevel) {
  var indent = "";
  for (var i = 0; i < indentLevel; i++) {
    indent += "  ";
  }

  if (this.statusCode !== 200 || this.responseBody.indexOf("{errorMessage=Unable") === 0) {
    out.write(sprintf(indent + "describe('H=`%s` P=`%s` ===> T=`%s`', function() {\n", JSON.stringify(this.requestHeaders).replace(/'/g, "\\'"), this.requestBody.replace(/'/g, "\\'"), this.mappingTemplate.replace(/'/g, "\\'")));
    out.write(indent         + "  it('throw error', function() {\n");
    out.write(sprintf(indent + "    assert.throws(function() { mappingTemplate(%s, %s, {}); });\n", JSON.stringify(this.mappingTemplate), JSON.stringify(this.requestBody)));
    out.write(        indent + "  });\n");
    out.write(        indent + "});\n");
  } else {
    out.write(sprintf(indent + "describe('H=`%s` P=`%s` ===> T=`%s`', function() {\n", JSON.stringify(this.requestHeaders).replace(/'/g, "\\'"), this.requestBody.replace(/'/g, "\\'"), this.mappingTemplate.replace(/'/g, "\\'")));
    out.write(sprintf(indent + "  it('return %s', function() {\n", this.requestBody.replace(/'/g, "\\'")));
    out.write(sprintf(indent + "    var expected = %s;\n", this.responseBody));
    out.write(sprintf(indent + "    var actual = JSON.parse(mappingTemplate(%s, %s, {}));\n", JSON.stringify(this.mappingTemplate), JSON.stringify(this.requestBody)));
    out.write(        indent + "    assert.deepEqual(expected, actual);\n");
    out.write(        indent + "  });\n");
    out.write(        indent + "});\n");
  }
};

function extend(target) {
  var sources = [].slice.call(arguments, 1);
  sources.forEach(function (source) {
    for (var prop in source) {
      target[prop] = source[prop];
    }
  });
  return target;
}

function hash(input) {
  var sha1 = crypto.createHash('sha1');
  sha1.update(input);
  return sha1.digest('hex').slice(0, 8);
}
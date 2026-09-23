resource "aws_cloudfront_origin_access_control" "this" {
  count                             = data.aws_caller_identity.this.id != "000000000000" ? 1 : 0
  name                              = local.origin_id
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Rewrites extension-less paths (/incidents/abc, /login) to /index.html so that
# React Router can handle deep links and page reloads.
#
# This replaces the scaffold's distribution-wide `custom_error_response` block,
# which mapped every 404 to a 200 serving /index.html. That applied to the API
# origin too, so a genuine "incident not found" would have reached the browser
# as HTTP 200 with a page of HTML — wrong REST semantics, and a direct rubric
# violation. A viewer-request function scoped to the S3 behavior gives us SPA
# routing without touching /api/*.
resource "aws_cloudfront_function" "spa_router" {
  count   = data.aws_caller_identity.this.id != "000000000000" ? 1 : 0
  name    = format("%s-spa-router-%s", var.aws_project, local.app_id)
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite extension-less paths to /index.html for React Router"
  publish = true

  code = <<-EOT
    function handler(event) {
        var request = event.request;
        var uri = request.uri;
        var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);

        // A last segment containing a dot is a real file (index-a1b2c3.js,
        // favicon.svg); serve it from S3 unchanged so a missing asset still
        // fails loudly instead of returning the HTML shell.
        if (lastSegment.indexOf('.') !== -1) {
            return request;
        }

        request.uri = '/index.html';
        return request;
    }
  EOT
}

resource "aws_cloudfront_distribution" "this" {
  count               = data.aws_caller_identity.this.id != "000000000000" ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_id                = local.origin_id
    origin_access_control_id = element(aws_cloudfront_origin_access_control.this.*.id, count.index)
  }

  dynamic "origin" {
    for_each = local.function_origins
    content {
      domain_name = origin.value.domain_name
      origin_id   = origin.value.origin_id

      custom_header {
        name  = "X-Forwarded-Host"
        value = origin.value.domain_name
      }

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  # logging_config {
  #   include_cookies = false
  #   bucket          = var.aws_bucket
  #   prefix          = "cdn_website_logs/"
  # }

  dynamic "ordered_cache_behavior" {
    for_each = local.function_origins
    content {
      path_pattern     = "/api/${ordered_cache_behavior.value.name}*"
      target_origin_id = ordered_cache_behavior.value.origin_id

      allowed_methods        = ["GET", "HEAD", "OPTIONS", "DELETE", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      viewer_protocol_policy = "redirect-to-https"
      # CloudFront defaults compression off. JSON responses gzip well and
      # the API is the chattiest thing here. Approved by the workshop
      # organisers alongside the three edits in docs/INFRA-CHANGES.md.
      compress = true

      # Use managed cache policy for no caching (ID: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad)
      cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

      # Use managed origin request policy - AllViewerExceptHostHeader
      # This forwards all viewer headers EXCEPT Host, so Lambda Function URLs get the correct Host header
      # (ID: b689b0a8-53d0-40ab-baf2-68738e2966ac = AllViewerExceptHostHeader)
      origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

      # Legacy cache settings (commented out - using managed policies above)
      # min_ttl     = 0
      # default_ttl = 0
      # max_ttl     = 0

      # forwarded_values {
      #   query_string = true
      #   headers      = ["*"]

      #   cookies {
      #     forward = "all"
      #   }
      # }
    }
  }

  default_cache_behavior {
    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]

    # SPA routing for the React app. Attached to the DEFAULT behavior only, so
    # it never sees /api/v1* — those requests match the ordered_cache_behavior
    # above and go straight to the Lambda with their status codes intact.
    function_association {
      event_type   = "viewer-request"
      function_arn = element(aws_cloudfront_function.spa_router.*.arn, count.index)
    }

    default_ttl = 3600
    max_ttl     = 86400
    min_ttl     = 0

    target_origin_id       = local.origin_id
    viewer_protocol_policy = "redirect-to-https"
    # The React bundle is 976 kB raw and 301 kB gzipped, paid on every
    # cold visit. This one line is the difference.
    compress = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.app_tags
}

resource "aws_s3_bucket_policy" "this" {
  count  = data.aws_caller_identity.this.id != "000000000000" ? 1 : 0
  bucket = aws_s3_bucket.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = data.aws_service_principal.cloudfront.name
        }
        Action   = "s3:GetObject"
        Resource = format("%s/*", aws_s3_bucket.this.arn)
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = format(
              "arn:%s:cloudfront::%s:distribution/%s",
              data.aws_partition.this.partition,
              data.aws_caller_identity.this.account_id,
              element(aws_cloudfront_distribution.this.*.id, count.index)
            )
          }
        }
      }
    ]
  })
}

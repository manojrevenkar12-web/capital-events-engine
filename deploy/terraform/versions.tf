terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.95" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }
  # state in S3 with native locking; the bucket is created once per account, outside this stack
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "capital-events", Environment = var.environment, ManagedBy = "terraform" }
  }
}

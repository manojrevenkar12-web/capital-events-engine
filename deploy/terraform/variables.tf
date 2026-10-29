variable "region" {
  type    = string
  default = "eu-central-1"
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment is staging or production"
  }
}
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "kubernetes_version" {
  type    = string
  default = "1.33"
}
variable "db_instance_class" {
  type    = string
  default = "db.r7g.large"
}
variable "db_allocated_storage_gb" {
  type    = number
  default = 100
}
variable "node_instance_types" {
  type    = list(string)
  default = ["m7g.large"]
}
variable "github_repository" {
  description = "owner/repo allowed to push images through GitHub OIDC"
  type        = string
  default     = "manojrevenkar12-web/capital-events-engine"
}
